package com.qa.utility.audit;

import com.qa.utility.model.ConnectionProfile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;

/** Append-only audit trail. Parameter values must be masked by the caller. */
@Service
public class AuditService {
    private final JdbcTemplate jdbc;

    public AuditService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void record(String action, ConnectionProfile conn, String sql, String paramsMasked, Integer rowsAffected,
                       String status, String detail) {
        jdbc.update("INSERT INTO audit_log (action, actor, connection_name, environment, sql_text, params_masked, rows_affected, status, detail) "
                        + "VALUES (?,?,?,?,?,?,?,?,?)",
                action, System.getProperty("user.name"), conn == null ? null : conn.name(),
                conn == null ? null : conn.environment(), sql, paramsMasked, rowsAffected, status, trunc(detail));
    }

    public List<Map<String, Object>> recent(int limit) {
        return jdbc.queryForList("SELECT id, occurred_at, action, actor, connection_name, environment, sql_text, params_masked, rows_affected, status, detail "
                + "FROM audit_log ORDER BY id DESC LIMIT ?", Math.min(Math.max(limit, 1), 500));
    }

    private static String trunc(String s) {
        return s == null || s.length() <= 1900 ? s : s.substring(0, 1900);
    }
}
