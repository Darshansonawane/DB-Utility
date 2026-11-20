package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.dto.SqlDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.repository.SavedQueryRepository;
import com.qa.utility.security.SqlValidator.ParsedSql;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Saved query library: the allowlist of executable statements with their parameter (form) definitions. */
@Service
public class QueryLibraryService {
    private static final Pattern COLUMN_BEFORE_PLACEHOLDER = Pattern.compile(
            "(?i)(?:[`\\w]+\\.)?`?([A-Za-z_][A-Za-z0-9_]*)`?\\s*(?:=|<>|!=|<=|>=|<|>|\\bLIKE\\b)\\s*\\?");

    private final SavedQueryRepository repo;
    private final SqlExecutionService sql;
    private final TargetDataSourceProvider provider;
    private final AuditService audit;
    private final com.qa.utility.automation.VariableService variables;
    private final MongoExecutionService mongo;
    private final MongoTargetProvider mongoProvider;

    public QueryLibraryService(SavedQueryRepository repo, SqlExecutionService sql, TargetDataSourceProvider provider, AuditService audit,
                               com.qa.utility.automation.VariableService variables, MongoExecutionService mongo, MongoTargetProvider mongoProvider) {
        this.mongo = mongo;
        this.mongoProvider = mongoProvider;
        this.repo = repo;
        this.sql = sql;
        this.provider = provider;
        this.audit = audit;
        this.variables = variables;
    }

    public List<SavedQuery> search(String text, String category) {
        return repo.search(text, category);
    }

    public List<String> categories() {
        return repo.categories();
    }

    public SavedQuery get(long id) {
        return repo.findById(id).orElseThrow(() -> ApiException.notFound("Query not found"));
    }

    public SavedQuery create(SavedQuery q) {
        SavedQuery n = normalise(q);
        try {
            long id = repo.insert(n);
            audit.record("QUERY_CREATED", null, n.sql(), null, null, "SUCCESS", n.name());
            return get(id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A query named '" + n.name() + "' already exists");
        }
    }

    public SavedQuery update(long id, SavedQuery q) {
        get(id);
        SavedQuery n = normalise(q);
        try {
            repo.update(id, n);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A query named '" + n.name() + "' already exists");
        }
        audit.record("QUERY_UPDATED", null, n.sql(), null, null, "SUCCESS", n.name());
        return get(id);
    }

    public void delete(long id) {
        SavedQuery q = get(id);
        if (repo.usedByWorkflow(id)) throw ApiException.conflict("Query is used by a workflow step. Remove it from the workflow first.");
        repo.delete(id);
        audit.record("QUERY_DELETED", null, q.sql(), null, null, "SUCCESS", q.name());
    }

    public java.util.Map<Long, Long> folderAssignments() {
        return repo.folderAssignments();
    }

    public void moveToFolder(long id, long folderId) {
        get(id);
        repo.setFolder(id, folderId);
    }

    public SavedQuery duplicate(long id) {
        SavedQuery q = get(id);
        String base = q.name() + " (copy)";
        String name = base;
        for (int i = 2; repo.findByName(name).isPresent(); i++) name = base + " " + i;
        SavedQuery copy = create(new SavedQuery(null, name, q.description(), q.category(), q.sql(), q.queryType(), q.environments(), q.enabled(), q.databaseName(), q.parameters(), q.extractions(), q.engine()));
        repo.setFolder(copy.id(), repo.folderOf(id));
        return copy;
    }

    public SavedQuery setEnabled(long id, boolean enabled) {
        get(id);
        repo.setEnabled(id, enabled);
        return get(id);
    }

    /** Checks SQL, forces the read/write classification to match what the SQL really does and the param count to match "?". */
    SavedQuery normalise(SavedQuery q) {
        if (q.engine() == DbType.MONGODB) return normaliseMongo(q);
        ParsedSql p = sql.validate(q.sql());
        QueryType actual = p.type().isWrite() ? QueryType.WRITE : QueryType.READ;
        if (q.queryType() != null && q.queryType() != actual) {
            throw ApiException.badRequest("Classification mismatch: this SQL is a " + actual + " statement but was marked " + q.queryType());
        }
        if (p.placeholders() != q.parameters().size()) {
            throw ApiException.badRequest("SQL has " + p.placeholders() + " '?' placeholder(s) but " + q.parameters().size()
                    + " parameter definition(s). Define exactly one parameter per '?', in order.");
        }
        Set<String> names = new HashSet<>();
        for (QueryParameter qp : q.parameters()) {
            if (!names.add(qp.name().toLowerCase())) throw ApiException.badRequest("Duplicate parameter name '" + qp.name() + "'");
        }
        return new SavedQuery(q.id(), q.name().trim(), q.description(), q.category(), p.sql().equals(q.sql().trim()) ? q.sql().trim() : q.sql().trim(),
                actual, q.environments().stream().map(Environments::canonical).filter(e -> !e.isEmpty()).distinct().toList(), q.enabled(), q.databaseName(), q.parameters(), q.extractions(), q.engine());
    }

    /** MongoDB queries are JSON specs and always read-only; "?" strings inside the JSON are the parameters. */
    private SavedQuery normaliseMongo(SavedQuery q) {
        MongoExecutionService.Spec spec = mongo.validate(q.sql());
        if (q.queryType() == QueryType.WRITE) throw ApiException.badRequest("MongoDB queries are read-only");
        if (spec.placeholders() != q.parameters().size()) {
            throw ApiException.badRequest("The query has " + spec.placeholders() + " \"?\" placeholder(s) but " + q.parameters().size()
                    + " parameter definition(s). Define exactly one parameter per \"?\", in document order.");
        }
        Set<String> names = new HashSet<>();
        for (QueryParameter qp : q.parameters()) {
            if (!names.add(qp.name().toLowerCase())) throw ApiException.badRequest("Duplicate parameter name '" + qp.name() + "'");
        }
        return new SavedQuery(q.id(), q.name().trim(), q.description(), q.category(), q.sql().trim(), QueryType.READ,
                q.environments().stream().map(Environments::canonical).filter(e -> !e.isEmpty()).distinct().toList(), q.enabled(), q.databaseName(),
                q.parameters(), q.extractions(), DbType.MONGODB);
    }

    public SqlAnalysis analyze(String text) {
        ParsedSql p = sql.validate(text);
        List<QueryParameter> suggestions = new ArrayList<>();
        Matcher m = COLUMN_BEFORE_PLACEHOLDER.matcher(p.masked());
        // map each '?' index to the column that precedes it
        Map<Integer, String> byIndex = new HashMap<>();
        while (m.find()) {
            int idx = (int) p.masked().substring(0, m.end()).chars().filter(c -> c == '?').count() - 1;
            byIndex.put(idx, m.group(1));
        }
        // SET col = ? in UPDATE also matches the pattern; INSERT VALUES (?,?) falls back to param_N
        Set<String> used = new HashSet<>();
        for (int i = 0; i < p.placeholders(); i++) {
            String col = byIndex.getOrDefault(i, "param_" + (i + 1)).toLowerCase();
            String name = col;
            for (int k = 2; !used.add(name); k++) name = col + "_" + k;
            suggestions.add(new QueryParameter(name, titleCase(col), guessType(col), true, null));
        }
        return new SqlAnalysis(p.type().name(), p.type().isWrite(), p.placeholders(), suggestions);
    }

    static ParamType guessType(String col) {
        String c = col.toLowerCase();
        if (c.contains("datetime") || c.endsWith("_at") || c.endsWith("timestamp")) return ParamType.DATETIME;
        if (c.contains("date")) return ParamType.DATE;
        if (c.startsWith("is_") || c.startsWith("has_")) return ParamType.BOOLEAN;
        if (c.contains("amount") || c.contains("balance") || c.contains("rate")) return ParamType.DECIMAL;
        return ParamType.STRING;
    }

    static String titleCase(String snake) {
        StringBuilder sb = new StringBuilder();
        for (String w : snake.split("_+")) {
            if (w.isEmpty()) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(w.equalsIgnoreCase("id") ? "ID" : Character.toUpperCase(w.charAt(0)) + w.substring(1));
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------ execution

    /** Converts form values into typed parameters using the stored definitions. Used by queries and workflows. */
    public List<BoundParam> bind(SavedQuery q, Map<String, String> values) {
        return bind(q, values, null);
    }

    public List<BoundParam> bind(SavedQuery q, Map<String, String> values, com.qa.utility.automation.VarScope scope) {
        List<BoundParam> out = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (QueryParameter p : q.parameters()) {
            String v = values == null ? null : values.get(p.name());
            if (v == null || v.isBlank()) v = p.defaultValue();
            if (v != null) v = variables.resolve(v, false, scope); // {{variable}} from API automation / Variables
            if (v == null || v.isBlank()) {
                if (p.required()) missing.add(p.label());
                out.add(new BoundParam(p.type(), null, p.label()));
            } else {
                BoundParam bp = new BoundParam(p.type(), v, p.label());
                bp.jdbcValue(); // validates type early with a readable message
                out.add(bp);
            }
        }
        if (!missing.isEmpty()) throw ApiException.badRequest("Required value(s) missing: " + String.join(", ", missing));
        return out;
    }

    public record ExtractionOutcome(List<com.qa.utility.automation.ApiDtos.ExtractedValue> values, List<String> problems) {
    }

    /** Saves the configured columns of the first result row into variables (run scope first, shared store per the scope's rules). */
    public ExtractionOutcome applyExtractions(SavedQuery q, QueryResult res, com.qa.utility.automation.VarScope scope) {
        return applyExtractions("sql:" + q.name(), q.extractions(), res, scope);
    }

    /** The same, for an explicit list of rules (a workflow step's own "save to variable" settings). */
    public ExtractionOutcome applyExtractions(String source, List<QueryExtraction> rules, QueryResult res, com.qa.utility.automation.VarScope scope) {
        List<com.qa.utility.automation.ApiDtos.ExtractedValue> values = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        if (rules.isEmpty()) return new ExtractionOutcome(values, problems);
        Map<String, Object> first = res.firstRow();
        for (QueryExtraction x : rules) {
            if (res.rowCount() == 0) {
                values.add(new com.qa.utility.automation.ApiDtos.ExtractedValue(x.variable(), null, x.secret(), false));
                problems.add("No rows returned, so '" + x.variable() + "' could not be extracted");
                continue;
            }
            if (!first.containsKey(x.column())) {
                values.add(new com.qa.utility.automation.ApiDtos.ExtractedValue(x.variable(), null, x.secret(), false));
                problems.add("Column '" + x.column() + "' not found for '" + x.variable() + "' (available: " + String.join(", ", first.keySet()) + ")");
                continue;
            }
            Object v = first.get(x.column());
            if (v == null) {
                values.add(new com.qa.utility.automation.ApiDtos.ExtractedValue(x.variable(), null, x.secret(), false));
                problems.add("Column '" + x.column() + "' is NULL, so '" + x.variable() + "' was not saved");
                continue;
            }
            String text = String.valueOf(v);
            variables.put(x.variable().trim(), text, x.secret(), source, scope, x.folderId());
            values.add(new com.qa.utility.automation.ApiDtos.ExtractedValue(x.variable(), x.secret() ? com.qa.utility.automation.VariableService.MASK : text, x.secret(), true));
        }
        return new ExtractionOutcome(values, problems);
    }

    public record ParamPreview(String name, String label, String type, String expression, String resolved, String status, String message,
                               List<com.qa.utility.automation.ApiDtos.TokenInfo> tokens) {
    }

    /** What each parameter would be bound to right now (variables filled in, secrets masked). Nothing is executed. */
    public List<ParamPreview> previewParams(long id, Map<String, String> values) {
        SavedQuery q = get(id);
        List<ParamPreview> out = new ArrayList<>();
        for (QueryParameter p : q.parameters()) {
            String expr = values == null ? null : values.get(p.name());
            if (expr == null || expr.isBlank()) expr = p.defaultValue();
            if (expr == null || expr.isBlank()) {
                out.add(new ParamPreview(p.name(), p.label(), p.type().name(), "", "", p.required() ? "MISSING" : "EMPTY",
                        p.required() ? "A value is required" : "Empty (NULL)", List.of()));
                continue;
            }
            var tokens = variables.analyze(expr, null);
            boolean missing = tokens.stream().anyMatch(t -> !t.found());
            String shown = variables.previewText(expr, null);
            String status = missing ? "MISSING_VARIABLE" : "OK";
            String msg = missing ? "Unresolved: " + tokens.stream().filter(t -> !t.found()).map(t -> t.token()).collect(java.util.stream.Collectors.joining(", ")) : null;
            if (!missing && tokens.stream().noneMatch(t -> t.origin().equals("built-in"))) {
                try {
                    new BoundParam(p.type(), variables.resolve(expr), p.label()).jdbcValue();
                } catch (ApiException e) {
                    status = "INVALID";
                    msg = e.getMessage();
                }
            }
            out.add(new ParamPreview(p.name(), p.label(), p.type().name(), expr, shown, status, msg, tokens));
        }
        return out;
    }

    /** Runs a READ query on the engine it was written for (MySQL or MongoDB). Used by saved-query runs and workflow steps. */
    public QueryResult run(SavedQuery q, List<BoundParam> bound, String token, SqlExecutionService.ExecContext ctx) {
        return q.engine() == DbType.MONGODB ? mongo.execute(q.sql(), bound, ctx) : sql.execute(q.sql(), bound, token, ctx);
    }

    /** Active connection for the given engine in this session. */
    public Optional<ConnectionProfile> activeProfile(DbType engine) {
        return engine == DbType.MONGODB ? mongoProvider.activeProfile() : provider.activeProfile();
    }

    public void checkRunnable(SavedQuery q) {
        if (!q.enabled()) throw ApiException.badRequest("Query '" + q.name() + "' is disabled");
        if (!q.environments().isEmpty()) {
            String env = activeProfile(q.engine()).map(ConnectionProfile::environment)
                    .orElseThrow(() -> ApiException.conflict("Not connected"));
            if (q.environments().stream().map(Environments::canonical).noneMatch(Environments.canonical(env)::equals)) {
                throw ApiException.forbidden("Query '" + q.name() + "' is restricted to " + q.environments() + " but the active environment is " + env);
            }
        }
    }

    /**
     * Runs a query that is still being written (not saved) so its output can be checked first. Read-only: a write query must be saved and
     * then run with the normal preview and confirmation. Nothing is stored except the usual execution history.
     */
    public QueryResult testRun(SavedQuery draft, Map<String, String> values) {
        String name = draft.name() == null || draft.name().isBlank() ? "Unsaved query" : draft.name();
        SavedQuery q = normalise(new SavedQuery(null, name, draft.description(), draft.category(), draft.sql(), draft.queryType(), draft.environments(), true,
                draft.databaseName(), draft.parameters(), draft.extractions(), draft.engine()));
        if (q.queryType() == QueryType.WRITE) {
            throw ApiException.badRequest("Write queries can't be test-run here. Save it, then run it from the list to preview and confirm the change.");
        }
        checkRunnable(q);
        return run(q, bind(q, values), null, new SqlExecutionService.ExecContext("QUERY_TEST", null, q.name(), false, q.databaseName()));
    }

    public QueryResult execute(long id, Map<String, String> values, String token) {
        SavedQuery q = get(id);
        checkRunnable(q);
        QueryResult res = run(q, bind(q, values), token, SqlExecutionService.ExecContext.saved(id, q.name(), q.databaseName()));
        if (q.queryType() == QueryType.READ && !q.extractions().isEmpty()) {
            res = res.withExtracted(applyExtractions(q, res, null).values());
        }
        return res;
    }

    public WritePreview preview(long id, Map<String, String> values) {
        SavedQuery q = get(id);
        checkRunnable(q);
        if (q.engine() == DbType.MONGODB) throw ApiException.badRequest("MongoDB queries are read-only and need no write preview");
        return sql.preview(q.sql(), bind(q, values), SqlExecutionService.ExecContext.saved(id, q.name(), q.databaseName()));
    }
}
