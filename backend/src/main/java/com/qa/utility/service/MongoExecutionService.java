package com.qa.utility.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mongodb.MongoCommandException;
import com.mongodb.MongoException;
import com.mongodb.MongoExecutionTimeoutException;
import com.mongodb.client.MongoCollection;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.model.CountOptions;
import com.qa.utility.dto.SqlDtos.Column;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.SqlDtos.SqlAnalysis;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.AppSettings;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.QueryParameter;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.Masking;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import org.bson.Document;
import org.bson.json.JsonMode;
import org.bson.json.JsonWriterSettings;
import org.bson.types.Binary;
import org.bson.types.Decimal128;
import org.bson.types.ObjectId;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Read-only MongoDB engine behind saved queries and workflows. A query is a JSON spec stored in the query's text, for example
 * {@code {"collection":"customers","operation":"find","filter":{"customerId":"?"},"limit":50}}. Every JSON string that is exactly
 * {@code "?"} is a typed placeholder bound in document order, mirroring the SQL engine. Results use the same {@link QueryResult}
 * shape, so tables, outputs, extractions and workflows work unchanged.
 */
@Service
public class MongoExecutionService {
    public record Spec(String collection, String operation, ObjectNode root, int placeholders) {
    }

    private static final Set<String> TOP_KEYS = Set.of("collection", "operation", "filter", "projection", "sort", "limit", "skip", "pipeline", "field");
    private static final Set<String> OPERATIONS = Set.of("find", "count", "aggregate", "distinct");
    /** Operators that run server-side code, write data or expose server internals. */
    private static final Set<String> FORBIDDEN = Set.of("$where", "$function", "$accumulator", "$out", "$merge", "$currentOp",
            "$listSessions", "$listLocalSessions", "$listSearchIndexes");
    private static final Pattern COLLECTION = Pattern.compile("^[A-Za-z0-9_.-]{1,120}$");
    private static final JsonWriterSettings JSON = JsonWriterSettings.builder().outputMode(JsonMode.RELAXED).build();
    private static final long JS_SAFE = 9_007_199_254_740_991L;
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final MongoTargetProvider provider;
    private final SettingsService settings;
    private final HistoryRepository history;
    private final ConnectionPolicy policy;

    public MongoExecutionService(MongoTargetProvider provider, SettingsService settings, HistoryRepository history, ConnectionPolicy policy) {
        this.provider = provider;
        this.settings = settings;
        this.history = history;
        this.policy = policy;
    }

    // ------------------------------------------------------------------ validation

    public Spec validate(String text) {
        if (text == null || text.isBlank()) throw ApiException.badRequest("MongoDB query is empty");
        JsonNode n;
        try {
            n = MAPPER.readTree(text);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw ApiException.badRequest("The MongoDB query is not valid JSON: " + e.getOriginalMessage());
        }
        if (n == null || !n.isObject()) throw ApiException.badRequest("The MongoDB query must be a JSON object with a \"collection\"");
        ObjectNode root = (ObjectNode) n;
        for (Iterator<String> it = root.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if (!TOP_KEYS.contains(k)) throw ApiException.badRequest("Unknown query key \"" + k + "\". Allowed: " + new TreeSet<>(TOP_KEYS));
        }
        String collection = root.path("collection").asText("");
        if (!COLLECTION.matcher(collection).matches() || collection.startsWith("system.")) {
            throw ApiException.badRequest("\"collection\" is required and must be a plain collection name");
        }
        String op = root.path("operation").asText("find").toLowerCase(Locale.ROOT);
        if (!OPERATIONS.contains(op)) throw ApiException.badRequest("Operation must be one of " + new TreeSet<>(OPERATIONS) + " (MongoDB queries are read-only)");
        for (String key : List.of("filter", "projection", "sort")) {
            if (root.has(key) && !root.get(key).isObject()) throw ApiException.badRequest("\"" + key + "\" must be a JSON object");
        }
        if (op.equals("aggregate")) {
            JsonNode p = root.get("pipeline");
            if (p == null || !p.isArray() || p.isEmpty()) throw ApiException.badRequest("An aggregate query needs a non-empty \"pipeline\" array");
            for (JsonNode stage : p) {
                if (!stage.isObject() || stage.size() != 1 || !stage.fieldNames().next().startsWith("$")) {
                    throw ApiException.badRequest("Each pipeline stage must be an object with exactly one $stage key");
                }
            }
        } else if (root.has("pipeline")) {
            throw ApiException.badRequest("\"pipeline\" is only used by the aggregate operation");
        }
        if (op.equals("distinct") && root.path("field").asText("").isBlank()) throw ApiException.badRequest("A distinct query needs a \"field\"");
        if (root.has("limit") && (!root.get("limit").canConvertToInt() || root.get("limit").asInt() < 1)) throw ApiException.badRequest("\"limit\" must be a positive whole number");
        if (root.has("skip") && (!root.get("skip").canConvertToInt() || root.get("skip").asInt() < 0)) throw ApiException.badRequest("\"skip\" must be zero or more");
        scanForbidden(root);
        int[] count = {0};
        countPlaceholders(root, count);
        return new Spec(collection, op, root, count[0]);
    }

    private static void scanForbidden(JsonNode n) {
        if (n.isObject()) {
            n.fields().forEachRemaining(e -> {
                if (FORBIDDEN.contains(e.getKey())) throw ApiException.badRequest("The operator " + e.getKey() + " is not allowed (it runs server code or writes data)");
                scanForbidden(e.getValue());
            });
        } else if (n.isArray()) {
            n.forEach(MongoExecutionService::scanForbidden);
        }
    }

    private static void countPlaceholders(JsonNode n, int[] count) {
        if (n.isTextual() && n.asText().equals("?")) count[0]++;
        else if (n.isObject()) n.fields().forEachRemaining(e -> countPlaceholders(e.getValue(), count));
        else if (n.isArray()) n.forEach(c -> countPlaceholders(c, count));
    }

    /** Suggests one parameter per "?" named after the field it filters on. */
    public SqlAnalysis analyze(String text) {
        Spec s = validate(text);
        List<String> keys = new ArrayList<>();
        collectKeys(s.root(), null, keys);
        List<QueryParameter> out = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (int i = 0; i < s.placeholders(); i++) {
            String raw = i < keys.size() && keys.get(i) != null ? keys.get(i) : "param_" + (i + 1);
            String col = raw.replaceAll("[^A-Za-z0-9_]", "_");
            if (!col.matches("^[A-Za-z].*")) col = "p_" + col;
            String name = col;
            for (int k = 2; !used.add(name); k++) name = col + "_" + k;
            out.add(new QueryParameter(name, QueryLibraryService.titleCase(col.toLowerCase(Locale.ROOT)), QueryLibraryService.guessType(col), true, null));
        }
        return new SqlAnalysis("MONGO_" + s.operation().toUpperCase(Locale.ROOT), false, s.placeholders(), out);
    }

    private static void collectKeys(JsonNode n, String key, List<String> out) {
        if (n.isTextual() && n.asText().equals("?")) out.add(key);
        else if (n.isObject()) n.fields().forEachRemaining(e -> collectKeys(e.getValue(), e.getKey().startsWith("$") ? key : e.getKey(), out));
        else if (n.isArray()) n.forEach(c -> collectKeys(c, key, out));
    }

    // ------------------------------------------------------------------ execution

    public QueryResult execute(String text, List<BoundParam> params, ExecContext ctx) {
        Spec spec = validate(text);
        if (spec.placeholders() != params.size()) {
            throw ApiException.badRequest("Query has " + spec.placeholders() + " '?' placeholder(s) but " + params.size() + " value(s) were supplied");
        }
        AppSettings s = settings.get();
        long start = System.nanoTime();
        Optional<ConnectionProfile> conn = provider.activeProfile();
        QueryResult result = null;
        String error = null;
        try {
            result = run(spec, params, s, ctx.database());
            return result;
        } catch (RuntimeException e) {
            error = e.getMessage();
            throw e;
        } finally {
            long ms = (System.nanoTime() - start) / 1_000_000;
            List<String> raw = params.stream().map(BoundParam::raw).toList();
            history.recordExecution(ctx.kind(), ctx.queryId(), ctx.queryName(), text,
                    conn.map(ConnectionProfile::name).map(n -> ctx.database() == null ? n : n + " / " + ctx.database()).orElse(null),
                    conn.map(ConnectionProfile::environment).orElse(null), error == null ? "SUCCESS" : "FAILED", ms,
                    result == null ? null : result.rowCount(), null, error, s.maskSensitiveData() ? Masking.maskAll(raw) : raw.toString());
        }
    }

    private QueryResult run(Spec spec, List<BoundParam> params, AppSettings s, String databaseOverride) {
        long start = System.nanoTime();
        ObjectNode bound = (ObjectNode) bind(spec.root(), params.iterator());
        String dbName = databaseOverride != null && !databaseOverride.isBlank() ? databaseOverride : provider.defaultDatabase();
        if (dbName == null || dbName.isBlank()) throw ApiException.badRequest("No database selected. Choose a database in the top bar first.");
        if (databaseOverride != null && !databaseOverride.isBlank()) policy.validateDatabase(databaseOverride);
        int max = s.maxResultRows();
        int fetch = max + 1;
        long timeout = s.queryTimeoutSeconds();
        try {
            MongoDatabase db = provider.client().getDatabase(dbName);
            MongoCollection<Document> coll = db.getCollection(spec.collection());
            Document filter = bound.has("filter") ? doc(bound.get("filter")) : new Document();
            List<Document> docs = new ArrayList<>();
            switch (spec.operation()) {
                case "find" -> {
                    var it = coll.find(filter).maxTime(timeout, TimeUnit.SECONDS);
                    if (bound.has("projection")) it.projection(doc(bound.get("projection")));
                    if (bound.has("sort")) it.sort(doc(bound.get("sort")));
                    if (bound.has("skip")) it.skip(bound.get("skip").asInt());
                    it.limit(Math.min(bound.has("limit") ? bound.get("limit").asInt() : fetch, fetch));
                    it.into(docs);
                }
                case "count" -> docs.add(new Document("count", coll.countDocuments(filter, new CountOptions().maxTime(timeout, TimeUnit.SECONDS))));
                case "distinct" -> {
                    List<Document> pipeline = List.of(new Document("$match", filter),
                            new Document("$group", new Document("_id", "$" + bound.get("field").asText())),
                            new Document("$sort", new Document("_id", 1)), new Document("$limit", fetch));
                    for (Document d : coll.aggregate(pipeline).maxTime(timeout, TimeUnit.SECONDS)) docs.add(new Document("value", d.get("_id")));
                }
                default -> {
                    List<Document> pipeline = new ArrayList<>();
                    for (JsonNode stage : bound.get("pipeline")) pipeline.add(doc(stage));
                    pipeline.add(new Document("$limit", fetch));
                    coll.aggregate(pipeline).maxTime(timeout, TimeUnit.SECONDS).into(docs);
                }
            }
            return toResult(docs, max, start, "MONGO_" + spec.operation().toUpperCase(Locale.ROOT));
        } catch (MongoExecutionTimeoutException e) {
            throw new ApiException(HttpStatus.REQUEST_TIMEOUT, "Query exceeded the " + timeout + "s execution timeout and was cancelled.", e);
        } catch (MongoCommandException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MongoDB error (code " + e.getErrorCode() + "): " + e.getErrorMessage(), e);
        } catch (MongoException e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MongoDB error: " + com.qa.utility.connection.Errors.root(e), e);
        } catch (IllegalArgumentException | org.bson.json.JsonParseException e) {
            throw ApiException.badRequest("Invalid MongoDB query value: " + e.getMessage());
        }
    }

    private static Document doc(JsonNode n) {
        return Document.parse(n.toString());
    }

    /** Replaces each "?" string, in document order, with the typed parameter value. */
    static JsonNode bind(JsonNode n, Iterator<BoundParam> params) {
        JsonNodeFactory f = JsonNodeFactory.instance;
        if (n.isTextual() && n.asText().equals("?")) return valueNode(params.next());
        if (n.isObject()) {
            ObjectNode o = f.objectNode();
            n.fields().forEachRemaining(e -> o.set(e.getKey(), bind(e.getValue(), params)));
            return o;
        }
        if (n.isArray()) {
            ArrayNode a = f.arrayNode();
            n.forEach(c -> a.add(bind(c, params)));
            return a;
        }
        return n;
    }

    private static JsonNode valueNode(BoundParam p) {
        JsonNodeFactory f = JsonNodeFactory.instance;
        Object v = p.jdbcValue();
        if (v == null) return f.nullNode();
        if (v instanceof Boolean b) return f.booleanNode(b);
        if (v instanceof Long l) return f.numberNode(l);
        if (v instanceof BigDecimal d) return f.numberNode(d);
        if (v instanceof java.sql.Date d) return dateNode(d.toLocalDate().atStartOfDay(ZoneOffset.UTC).toInstant().toString());
        if (v instanceof Timestamp t) return dateNode(t.toLocalDateTime().toInstant(ZoneOffset.UTC).toString());
        return f.textNode(v.toString());
    }

    private static JsonNode dateNode(String iso) {
        ObjectNode o = JsonNodeFactory.instance.objectNode();
        o.put("$date", iso);
        return o;
    }

    // ------------------------------------------------------------------ results

    private static QueryResult toResult(List<Document> docs, int max, long startNanos, String type) {
        boolean truncated = docs.size() > max;
        List<Document> shown = truncated ? docs.subList(0, max) : docs;
        Map<String, String> cols = new LinkedHashMap<>();
        for (Document d : shown) {
            for (Map.Entry<String, Object> e : d.entrySet()) {
                String t = e.getValue() == null ? null : typeName(e.getValue());
                cols.merge(e.getKey(), t == null ? "NULL" : t, (a, b) -> a.equals("NULL") ? b : a);
            }
        }
        List<Column> columns = cols.entrySet().stream().map(e -> new Column(e.getKey(), e.getValue())).toList();
        List<List<Object>> rows = new ArrayList<>();
        for (Document d : shown) {
            List<Object> row = new ArrayList<>(columns.size());
            for (Column c : columns) row.add(normalise(d.get(c.name())));
            rows.add(row);
        }
        return new QueryResult(columns, rows, truncated, rows.size(), null, (System.nanoTime() - startNanos) / 1_000_000, type);
    }

    private static String typeName(Object v) {
        if (v instanceof Number) return "NUMBER";
        if (v instanceof Boolean) return "BOOLEAN";
        if (v instanceof Date) return "DATE";
        if (v instanceof ObjectId) return "OBJECTID";
        if (v instanceof Document) return "DOCUMENT";
        if (v instanceof List) return "ARRAY";
        return "STRING";
    }

    static Object normalise(Object v) {
        if (v == null) return null;
        if (v instanceof Long l) return Math.abs(l) > JS_SAFE ? l.toString() : l;
        if (v instanceof Integer || v instanceof Short || v instanceof Byte || v instanceof Boolean || v instanceof String) return v;
        if (v instanceof Double d) return d.isNaN() || d.isInfinite() ? d.toString() : d;
        if (v instanceof ObjectId o) return o.toHexString();
        if (v instanceof Decimal128 d) return d.toString();
        if (v instanceof Date d) return d.toInstant().toString();
        if (v instanceof UUID u) return u.toString();
        if (v instanceof Binary b) {
            byte[] bytes = b.getData();
            StringBuilder sb = new StringBuilder("0x");
            for (int i = 0; i < Math.min(bytes.length, 32); i++) sb.append(String.format("%02x", bytes[i]));
            return bytes.length > 32 ? sb + "... (" + bytes.length + " bytes)" : sb.toString();
        }
        if (v instanceof Document d) return d.toJson(JSON);
        if (v instanceof List<?> l) {
            String j = new Document("v", l).toJson(JSON);
            return j.substring(j.indexOf(':') + 1, j.lastIndexOf('}')).trim();
        }
        return v.toString();
    }

    // ------------------------------------------------------------------ metadata

    /** Collections of the active MongoDB connection's database (or the given one). */
    public List<String> collections(String database) {
        String db = database == null || database.isBlank() ? provider.defaultDatabase() : database;
        if (db == null || db.isBlank()) throw ApiException.badRequest("No database selected. Choose a database in the top bar first.");
        if (database != null && !database.isBlank()) policy.validateDatabase(database);
        try {
            List<String> out = new ArrayList<>();
            for (String n : provider.client().getDatabase(db).listCollectionNames()) if (!n.startsWith("system.")) out.add(n);
            out.sort(String.CASE_INSENSITIVE_ORDER);
            return out;
        } catch (MongoException e) {
            throw ApiException.badRequest("MongoDB error: " + com.qa.utility.connection.Errors.root(e));
        }
    }
}
