package com.qa.utility.workflow;

import com.qa.utility.dto.SqlDtos.Column;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.SqlDtos.WritePreview;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.ParamType;
import com.qa.utility.model.SavedQuery;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.SqlValidator;
import com.qa.utility.service.SqlExecutionService;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import com.qa.utility.service.TargetDataSourceProvider;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Edit one cell of a workflow step's result and write it back to the database row it came from. Only a plain single-table SELECT whose
 * result contains the table's whole primary key qualifies, so the row is identified exactly. The change goes through the normal write
 * safeguards: a preview, a one-time confirmation token, read-only mode, the affected-row limit and the audit log.
 */
@Service
public class ResultEditService {
    public record EditRequest(int rowIndex, String column, String value, String confirmationToken) {
    }

    public record EditPreview(String table, List<String> keyColumns, String column, String oldValue, String newValue, WritePreview preview) {
    }

    public record EditResult(String column, String newValue, Integer affectedRows) {
    }

    record Plan(String schema, String table, List<String> keys, String column, int colIndex, String oldValue, String newValue, String sql, List<BoundParam> params) {
    }

    private static final Pattern FROM_CLAUSE = Pattern.compile("\\bFROM\\b(.*?)(?=\\bWHERE\\b|\\bORDER\\s+BY\\b|\\bLIMIT\\b|$)", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern TABLE_REF = Pattern.compile("^\\s*(?:`?([A-Za-z0-9_$]+)`?\\s*\\.\\s*)?`?([A-Za-z0-9_$]+)`?(?:\\s+(?:AS\\s+)?`?[A-Za-z0-9_$]+`?)?\\s*$", Pattern.CASE_INSENSITIVE);
    private static final Pattern UNSUPPORTED = Pattern.compile("\\b(JOIN|UNION|GROUP\\s+BY|HAVING|DISTINCT|INTERSECT|EXCEPT)\\b|\\bSELECT\\b.*\\bSELECT\\b", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern IDENT = Pattern.compile("^[A-Za-z0-9_$]+$");

    private final WorkflowExecutor executor;
    private final SqlExecutionService sql;
    private final TargetDataSourceProvider provider;
    private final ConnectionPolicy policy;
    private final SqlValidator validator;

    public ResultEditService(WorkflowExecutor executor, SqlExecutionService sql, TargetDataSourceProvider provider, ConnectionPolicy policy, SqlValidator validator) {
        this.executor = executor;
        this.sql = sql;
        this.provider = provider;
        this.policy = policy;
        this.validator = validator;
    }

    public EditPreview preview(String runId, int order, EditRequest r) {
        Plan p = plan(runId, order, r);
        SavedQuery q = executor.queryOf(runId, order);
        WritePreview wp = sql.preview(p.sql(), p.params(), ctx(q, order));
        return new EditPreview(p.schema() + "." + p.table(), p.keys(), p.column(), p.oldValue(), p.newValue(), wp);
    }

    public EditResult apply(String runId, int order, EditRequest r) {
        Plan p = plan(runId, order, r);
        SavedQuery q = executor.queryOf(runId, order);
        QueryResult done = sql.execute(p.sql(), p.params(), r.confirmationToken(), ctx(q, order));
        executor.patchCell(runId, order, r.rowIndex(), p.colIndex(), p.newValue());
        return new EditResult(p.column(), p.newValue(), done.affectedRows());
    }

    private ExecContext ctx(SavedQuery q, int order) {
        return new ExecContext("RESULT_EDIT", q.id(), q.name() + " (step " + order + ")", false, q.databaseName());
    }

    // ------------------------------------------------------------------ planning

    Plan plan(String runId, int order, EditRequest r) {
        StepRunView sv = executor.stepOf(runId, order);
        SavedQuery q = executor.queryOf(runId, order);
        if (q == null) throw ApiException.badRequest("Only the results of database query steps can be edited");
        if (q.engine() != com.qa.utility.model.DbType.MYSQL) throw ApiException.badRequest("Editing results is available for MySQL queries only");
        QueryResult res = sv.result();
        if (res == null || res.columns().isEmpty()) throw ApiException.badRequest("This step has no result rows to edit");
        if (r.rowIndex() < 0 || r.rowIndex() >= res.rows().size()) throw ApiException.badRequest("That row is not in the result");
        int colIndex = indexOf(res.columns(), r.column());
        if (colIndex < 0) throw ApiException.badRequest("Column '" + r.column() + "' is not in the result");

        String[] ref = tableOf(q.sql());
        String schema = ref[0] != null ? ref[0] : q.databaseName();
        String table = ref[1];
        try (Connection c = provider.current().getConnection()) {
            if (schema == null || schema.isBlank()) schema = c.getCatalog();
            if (schema == null || schema.isBlank()) throw ApiException.badRequest("Cannot tell which database this query reads from");
            policy.validateDatabase(schema);
            if (!IDENT.matcher(schema).matches() || !IDENT.matcher(table).matches()) throw ApiException.badRequest("Unsupported table name");

            java.sql.DatabaseMetaData md = c.getMetaData();
            List<String> keys = primaryKeys(md, schema, table);
            if (keys.isEmpty()) throw ApiException.badRequest("Table '" + table + "' has no primary key, so the row cannot be identified safely");
            Map<String, String[]> cols = columns(md, schema, table); // name(lower) -> {name, data type, nullable}
            String[] target = cols.get(r.column().toLowerCase(Locale.ROOT));
            if (target == null) throw ApiException.badRequest("'" + r.column() + "' is not a column of " + table + " (it may be computed or renamed in the query)");
            for (String k : keys) if (k.equalsIgnoreCase(target[0])) throw ApiException.badRequest("'" + target[0] + "' is part of the row's key and cannot be edited here");

            List<BoundParam> params = new ArrayList<>();
            String value = r.value();
            if (value != null && value.isBlank() && !"YES".equalsIgnoreCase(target[2])) throw ApiException.badRequest("'" + target[0] + "' cannot be empty");
            ParamType type = typeOf(target[1]);
            params.add(new BoundParam(type, value == null || (value.isBlank() && type != ParamType.STRING) ? null : value, target[0]));
            params.get(0).jdbcValue(); // reject a value that does not fit the column type before anything is previewed
            StringBuilder where = new StringBuilder();
            for (String k : keys) {
                int ki = indexOf(res.columns(), k);
                if (ki < 0) throw ApiException.badRequest("Add the key column '" + k + "' to the query's SELECT so the row can be identified");
                Object kv = res.rows().get(r.rowIndex()).get(ki);
                if (kv == null) throw ApiException.badRequest("Key column '" + k + "' is empty in this row");
                if (where.length() > 0) where.append(" AND ");
                where.append('`').append(k).append("` = ?");
                params.add(new BoundParam(typeOf(cols.get(k.toLowerCase(Locale.ROOT))[1]), String.valueOf(kv), k));
            }
            String updateSql = "UPDATE `" + schema + "`.`" + table + "` SET `" + target[0] + "` = ? WHERE " + where;
            Object old = res.rows().get(r.rowIndex()).get(colIndex);
            return new Plan(schema, table, keys, target[0], colIndex, old == null ? null : String.valueOf(old), value, updateSql, params);
        } catch (SQLException e) {
            throw ApiException.badRequest("Could not read the table definition: " + e.getMessage());
        }
    }

    /** The table's key columns in key order. MySQL names the database as the JDBC catalog; other databases use a schema. */
    private static List<String> primaryKeys(java.sql.DatabaseMetaData md, String schema, String table) throws SQLException {
        for (String[] where : new String[][]{{schema, null}, {null, schema}}) {
            Map<Integer, String> byPos = new java.util.TreeMap<>();
            try (ResultSet rs = md.getPrimaryKeys(where[0], where[1], table)) {
                while (rs.next()) byPos.put(rs.getInt("KEY_SEQ"), rs.getString("COLUMN_NAME"));
            }
            if (!byPos.isEmpty()) return new ArrayList<>(byPos.values());
        }
        return List.of();
    }

    private static Map<String, String[]> columns(java.sql.DatabaseMetaData md, String schema, String table) throws SQLException {
        for (String[] where : new String[][]{{schema, null}, {null, schema}}) {
            Map<String, String[]> out = new LinkedHashMap<>();
            try (ResultSet rs = md.getColumns(where[0], where[1], table, null)) {
                while (rs.next()) out.put(rs.getString("COLUMN_NAME").toLowerCase(Locale.ROOT), new String[]{rs.getString("COLUMN_NAME"), rs.getString("TYPE_NAME"), rs.getString("IS_NULLABLE")});
            }
            if (!out.isEmpty()) return out;
        }
        return Map.of();
    }

    /** {schema or null, table} of a plain single-table SELECT; throws when the query is anything else. */
    String[] tableOf(String rawSql) {
        SqlValidator.ParsedSql parsed = validator.validate(rawSql);
        if (parsed.type() != SqlValidator.StatementType.SELECT) throw ApiException.badRequest("Only SELECT results can be edited");
        String masked = parsed.masked();
        if (UNSUPPORTED.matcher(masked).find()) throw ApiException.badRequest("This query joins or groups several sources, so its rows cannot be edited. Use a single-table SELECT.");
        Matcher m = FROM_CLAUSE.matcher(masked);
        if (!m.find()) throw ApiException.badRequest("Cannot find the table this query reads from");
        String from = parsed.sql().substring(m.start(1), m.end(1));
        if (from.contains(",") || from.contains("(")) throw ApiException.badRequest("This query reads from more than one source, so its rows cannot be edited");
        Matcher t = TABLE_REF.matcher(from);
        if (!t.matches()) throw ApiException.badRequest("Cannot tell which table this query reads from");
        return new String[]{t.group(1), t.group(2)};
    }

    private static int indexOf(List<Column> cols, String name) {
        for (int i = 0; i < cols.size(); i++) if (cols.get(i).name().equalsIgnoreCase(name)) return i;
        return -1;
    }

    static ParamType typeOf(String dataType) {
        String t = dataType == null ? "" : dataType.toLowerCase(Locale.ROOT).split("[\\s(]")[0];
        return switch (t) {
            case "date" -> ParamType.DATE;
            case "datetime", "timestamp" -> ParamType.DATETIME;
            case "tinyint", "smallint", "mediumint", "int", "integer", "bigint" -> ParamType.INTEGER;
            case "decimal", "numeric", "float", "double" -> ParamType.DECIMAL;
            default -> ParamType.STRING;
        };
    }
}
