package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.config.AppProperties;
import com.qa.utility.dto.SqlDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.AppSettings;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.security.Masking;
import com.qa.utility.security.SqlValidator;
import com.qa.utility.security.SqlValidator.ParsedSql;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * The one generic SQL engine. Every statement (editor, saved query, workflow step) goes through here:
 * validation -> typed PreparedStatement binding -> timeout/row limits -> history and audit.
 * Writes from the editor and Saved Queries additionally need read-only mode off, a preview and a matching single-use confirmation
 * token; workflow steps run them automatically under the database user's privileges. Every write runs inside a transaction, is
 * rolled back when it exceeds the affected-row limit, and is audited.
 */
@Service
public class SqlExecutionService {
    /**
     * {@code database} (nullable) is the schema this statement must run in; null = the connection's active database.
     * {@code autoWrite}: workflow steps run INSERT / UPDATE / DELETE directly, with no preview, confirmation token or read-only
     * toggle. The database user's own privileges are then the only authority: the server accepts or rejects the statement.
     */
    public record ExecContext(String kind, Long queryId, String queryName, boolean adHoc, String database, boolean autoWrite) {
        public ExecContext(String kind, Long queryId, String queryName, boolean adHoc, String database) {
            this(kind, queryId, queryName, adHoc, database, false);
        }

        public static ExecContext editor() {
            return new ExecContext("SQL_EDITOR", null, null, true, null);
        }

        public static ExecContext saved(long id, String name) {
            return saved(id, name, null);
        }

        public static ExecContext saved(long id, String name, String database) {
            return new ExecContext("SAVED_QUERY", id, name, false, database);
        }

        public static ExecContext workflow(long id, String name) {
            return workflow(id, name, null);
        }

        public static ExecContext workflow(long id, String name, String database) {
            return new ExecContext("WORKFLOW_STEP", id, name, false, database, true);
        }
    }

    private static final long JS_SAFE = 9_007_199_254_740_991L;

    private final TargetDataSourceProvider provider;
    private final SqlValidator validator;
    private final SettingsService settings;
    private final AuditService audit;
    private final HistoryRepository history;
    private final WriteAnalyzer analyzer;
    private final ConfirmationService confirmations;
    private final AppProperties props;
    private final com.qa.utility.security.ConnectionPolicy policy;

    public SqlExecutionService(TargetDataSourceProvider provider, SqlValidator validator, SettingsService settings,
                               AuditService audit, HistoryRepository history, WriteAnalyzer analyzer,
                               ConfirmationService confirmations, AppProperties props,
                               com.qa.utility.security.ConnectionPolicy policy) {
        this.provider = provider;
        this.validator = validator;
        this.settings = settings;
        this.audit = audit;
        this.history = history;
        this.analyzer = analyzer;
        this.confirmations = confirmations;
        this.props = props;
        this.policy = policy;
    }

    public ParsedSql validate(String sql) {
        return validator.validate(sql);
    }

    // ------------------------------------------------------------------ execute

    public QueryResult execute(String sql, List<BoundParam> params, String confirmationToken, ExecContext ctx) {
        ParsedSql p = validator.validate(sql);
        checkParams(p, params);
        AppSettings s = settings.get();
        long start = System.nanoTime();
        Optional<ConnectionProfile> conn = provider.activeProfile();
        QueryResult result = null;
        String error = null;
        try {
            result = p.type().isWrite() ? executeWrite(p, params, confirmationToken, ctx, s) : executeRead(p, params, s, ctx.database());
            return result;
        } catch (RuntimeException e) {
            error = e.getMessage();
            throw e;
        } finally {
            long ms = (System.nanoTime() - start) / 1_000_000;
            history.recordExecution(ctx.kind(), ctx.queryId(), ctx.queryName(), p.sql(),
                    conn.map(ConnectionProfile::name).map(n -> ctx.database() == null ? n : n + " / " + ctx.database()).orElse(null), conn.map(ConnectionProfile::environment).orElse(null),
                    error == null ? "SUCCESS" : "FAILED", ms,
                    result == null || p.type().isWrite() ? null : result.rowCount(),
                    result == null ? null : result.affectedRows(), error, maskedParams(params, s));
        }
    }

    /** Borrows a pooled connection and, when a target database is given, switches to it (the pool resets it on close). */
    private Connection open(String database) throws SQLException {
        Connection c = provider.current().getConnection();
        if (database != null && !database.isBlank()) {
            try {
                policy.validateDatabase(database);
                c.setCatalog(database);
            } catch (SQLException | RuntimeException e) {
                c.close();
                if (e instanceof SQLException se) throw se;
                throw (RuntimeException) e;
            }
        }
        return c;
    }

    private QueryResult executeRead(ParsedSql p, List<BoundParam> params, AppSettings s, String db) {
        long start = System.nanoTime();
        try (Connection c = open(db)) {
            c.setReadOnly(true);
            try (PreparedStatement ps = c.prepareStatement(p.sql())) {
                bind(ps, params);
                ps.setQueryTimeout(s.queryTimeoutSeconds());
                ps.setMaxRows(s.maxResultRows() + 1);
                boolean hasRs = ps.execute();
                if (!hasRs) throw ApiException.badRequest("Statement did not return a result set");
                try (ResultSet rs = ps.getResultSet()) {
                    return readResult(rs, s.maxResultRows(), start, p);
                }
            } finally {
                try {
                    c.setReadOnly(false);
                } catch (SQLException ignored) {
                    // pool resets on close
                }
            }
        } catch (SQLException e) {
            throw translate(e, s);
        }
    }

    private QueryResult executeWrite(ParsedSql p, List<BoundParam> params, String token, ExecContext ctx, AppSettings s) {
        ConnectionProfile conn = provider.activeProfile().orElse(null);
        String masked = maskedParams(params, s);
        if (!ctx.autoWrite()) { // workflow steps skip this: the database user's privileges decide, and the database reports any refusal
            String block = writeBlockedReason(ctx, s);
            if (block != null) {
                audit.record("WRITE_REJECTED", conn, p.sql(), masked, null, "REJECTED", block);
                throw ApiException.forbidden(block);
            }
            try {
                confirmations.consume(token, fp(p.sql(), ctx.database()), params, conn == null ? null : conn.id());
            } catch (ApiException e) {
                audit.record("WRITE_REJECTED", conn, p.sql(), masked, null, "REJECTED", e.getMessage());
                throw e;
            }
        }
        long start = System.nanoTime();
        try (Connection c = open(ctx.database())) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement(p.sql())) {
                bind(ps, params);
                ps.setQueryTimeout(s.queryTimeoutSeconds());
                int n = ps.executeUpdate();
                if (n > s.maxAffectedRows()) {
                    c.rollback();
                    String msg = "Rolled back: statement affected " + n + " rows, above the limit of " + s.maxAffectedRows() + ".";
                    audit.record("WRITE_REJECTED", conn, p.sql(), masked, 0, "ROLLED_BACK", msg);
                    throw ApiException.badRequest(msg);
                }
                c.commit();
                audit.record("WRITE_EXECUTE", conn, p.sql(), masked, n, "SUCCESS", ctx.kind() + (ctx.queryName() == null ? "" : ": " + ctx.queryName()));
                long ms = (System.nanoTime() - start) / 1_000_000;
                return new QueryResult(List.of(), List.of(), false, 0, n, ms, p.type().name());
            } catch (SQLException | RuntimeException e) {
                try {
                    c.rollback();
                } catch (SQLException ignored) {
                    // connection already unusable
                }
                if (e instanceof ApiException a) throw a;
                audit.record("WRITE_EXECUTE", conn, p.sql(), masked, null, "FAILED", e.getMessage());
                throw e instanceof SQLException se ? translate(se, s) : (RuntimeException) e;
            }
        } catch (SQLException e) {
            throw translate(e, s);
        }
    }

    // ------------------------------------------------------------------ preview

    public WritePreview preview(String sql, List<BoundParam> params, ExecContext ctx) {
        ParsedSql p = validator.validate(sql);
        checkParams(p, params);
        if (!p.type().isWrite()) throw ApiException.badRequest("Preview applies to INSERT, UPDATE and DELETE statements only");
        AppSettings s = settings.get();
        ConnectionProfile conn = provider.activeProfile().orElseThrow(() -> ApiException.conflict("Not connected"));
        List<String> warnings = new ArrayList<>();
        Long affected = null;
        List<Column> cols = List.of();
        List<List<Object>> rows = List.of();
        List<Assignment> changes = List.of();
        boolean derivedOk = false;

        Optional<WriteAnalyzer.Derived> d = analyzer.derive(p, params);
        try {
            if (d.isPresent()) {
                derivedOk = true;
                changes = d.get().assignments();
                affected = scalarCount(d.get().countSql(), d.get().selectParams(), s, ctx.database());
                if (affected > 0) {
                    ParsedSql sel = validator.validate(d.get().selectSql());
                    AppSettings small = new AppSettings(s.readOnlyMode(), props.previewRows(), s.queryTimeoutSeconds(),
                            s.maxAffectedRows(), s.adHocWritesEnabled(), s.maskSensitiveData());
                    QueryResult r = executeRead(sel, d.get().selectParams(), small, ctx.database());
                    cols = r.columns();
                    rows = r.rows();
                    if (affected > rows.size()) warnings.add("Showing the first " + rows.size() + " of " + affected + " target rows.");
                }
            } else if (p.type() == SqlValidator.StatementType.INSERT) {
                warnings.add("Row count for INSERT is only known after execution; the affected-row limit is enforced and the transaction is rolled back if exceeded.");
            } else {
                affected = dryRun(p, params, s, ctx.database());
                warnings.add("Statement is too complex to derive a target-row preview; the affected-row count came from a dry run that was rolled back (reliable for InnoDB tables only).");
            }
        } catch (SQLException e) {
            throw translate(e, s);
        }

        String blocked = writeBlockedReason(ctx, s);
        boolean within = affected == null || affected <= s.maxAffectedRows();
        if (!within) {
            blocked = blocked != null ? blocked : "Statement would affect " + affected + " rows, above the limit of "
                    + s.maxAffectedRows() + ". Tighten the WHERE clause or raise the limit in Settings.";
        }
        if (affected != null && affected == 0) warnings.add("No rows match: executing would change nothing.");
        boolean executable = blocked == null;
        String token = executable ? confirmations.issue(fp(p.sql(), ctx.database()), params, conn.id()) : null;
        audit.record("WRITE_PREVIEW", conn, p.sql(), maskedParams(params, s), affected == null ? null : affected.intValue(),
                executable ? "PREVIEWED" : "BLOCKED", blocked);
        return new WritePreview(p.type().name(), p.sql(), params.stream().map(BoundParam::raw).toList(), affected, cols, rows,
                changes, derivedOk, s.maxAffectedRows(), within, executable, blocked, token, warnings);
    }

    private long scalarCount(String countSql, List<BoundParam> params, AppSettings s, String db) throws SQLException {
        try (Connection c = open(db)) {
            c.setReadOnly(true);
            try (PreparedStatement ps = c.prepareStatement(countSql)) {
                bind(ps, params);
                ps.setQueryTimeout(s.queryTimeoutSeconds());
                try (ResultSet rs = ps.executeQuery()) {
                    rs.next();
                    return rs.getLong(1);
                }
            } finally {
                try {
                    c.setReadOnly(false);
                } catch (SQLException ignored) {
                    // pool resets on close
                }
            }
        }
    }

    private long dryRun(ParsedSql p, List<BoundParam> params, AppSettings s, String db) throws SQLException {
        try (Connection c = open(db)) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement(p.sql())) {
                bind(ps, params);
                ps.setQueryTimeout(s.queryTimeoutSeconds());
                return ps.executeUpdate();
            } finally {
                c.rollback();
            }
        }
    }

    private String writeBlockedReason(ExecContext ctx, AppSettings s) {
        if (s.readOnlyMode()) return "Read-only mode is ON. Turn it off in Settings to run write statements.";
        if (ctx.adHoc() && !s.adHocWritesEnabled()) {
            return "Ad-hoc writes are disabled. Save the statement to the query library (the allowlist) and run it from there, or enable ad-hoc writes in Settings.";
        }
        return null;
    }

    // ------------------------------------------------------------------ helpers

    private static String fp(String sql, String database) {
        return database == null || database.isBlank() ? sql : "/*db:" + database + "*/" + sql;
    }

    private void checkParams(ParsedSql p, List<BoundParam> params) {
        if (p.placeholders() != params.size()) {
            throw ApiException.badRequest("Statement has " + p.placeholders() + " '?' placeholder(s) but " + params.size() + " value(s) were supplied");
        }
    }

    private static void bind(PreparedStatement ps, List<BoundParam> params) throws SQLException {
        for (int i = 0; i < params.size(); i++) {
            Object v = params.get(i).jdbcValue();
            if (v == null) ps.setNull(i + 1, Types.NULL);
            else ps.setObject(i + 1, v);
        }
    }

    private QueryResult readResult(ResultSet rs, int max, long startNanos, ParsedSql p) throws SQLException {
        ResultSetMetaData md = rs.getMetaData();
        int n = md.getColumnCount();
        List<Column> cols = new ArrayList<>();
        for (int i = 1; i <= n; i++) cols.add(new Column(md.getColumnLabel(i), md.getColumnTypeName(i)));
        List<List<Object>> rows = new ArrayList<>();
        boolean truncated = false;
        while (rs.next()) {
            if (rows.size() >= max) {
                truncated = true;
                break;
            }
            List<Object> row = new ArrayList<>(n);
            for (int i = 1; i <= n; i++) row.add(normalise(rs.getObject(i)));
            rows.add(row);
        }
        long ms = (System.nanoTime() - startNanos) / 1_000_000;
        return new QueryResult(cols, rows, truncated, rows.size(), null, ms, p.type().name());
    }

    static Object normalise(Object v) throws SQLException {
        if (v == null) return null;
        if (v instanceof Long l) return Math.abs(l) > JS_SAFE ? l.toString() : l;
        if (v instanceof BigDecimal || v instanceof BigInteger) return v.toString();
        if (v instanceof Integer || v instanceof Short || v instanceof Byte || v instanceof Double || v instanceof Float || v instanceof Boolean || v instanceof String) return v;
        if (v instanceof Timestamp t) return t.toLocalDateTime().toString().replace('T', ' ');
        if (v instanceof java.sql.Date || v instanceof Time || v instanceof java.time.temporal.TemporalAccessor) return v.toString();
        if (v instanceof Clob c) return c.getSubString(1, (int) Math.min(c.length(), 100_000));
        if (v instanceof byte[] b) {
            StringBuilder sb = new StringBuilder("0x");
            for (int i = 0; i < Math.min(b.length, 32); i++) sb.append(String.format("%02x", b[i]));
            return b.length > 32 ? sb + "... (" + b.length + " bytes)" : sb.toString();
        }
        return v.toString();
    }

    private String maskedParams(List<BoundParam> params, AppSettings s) {
        List<String> raw = params.stream().map(BoundParam::raw).toList();
        return s.maskSensitiveData() ? Masking.maskAll(raw) : raw.toString();
    }

    private ApiException translate(SQLException e, AppSettings s) {
        if (e instanceof SQLTimeoutException || (e.getMessage() != null && e.getMessage().toLowerCase().contains("timeout")
                && e.getSQLState() != null && e.getSQLState().startsWith("HY"))) {
            return new ApiException(HttpStatus.REQUEST_TIMEOUT, "Query exceeded the " + s.queryTimeoutSeconds() + "s execution timeout and was cancelled.", e);
        }
        if (e.getCause() instanceof ApiException a) return a;
        if (e.getErrorCode() == 1046) {
            return new ApiException(HttpStatus.BAD_REQUEST, "No database selected. Choose a database in the top bar, or qualify table names (database.table).", e);
        }
        String state = e.getSQLState() == null ? "" : "SQLState " + e.getSQLState() + ", ";
        return new ApiException(HttpStatus.BAD_REQUEST, "SQL error (" + state + "code " + e.getErrorCode() + "): " + e.getMessage(), e);
    }
}
