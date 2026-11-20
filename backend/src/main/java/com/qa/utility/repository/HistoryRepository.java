package com.qa.utility.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Execution history for ad-hoc/saved queries and workflow runs. Only masked identifiers are stored; never row data. */
@Repository
public class HistoryRepository {
    private final JdbcTemplate jdbc;

    public HistoryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void recordExecution(String kind, Long queryId, String queryName, String sql, String connection, String env,
                                String status, long durationMs, Integer rowsReturned, Integer rowsAffected,
                                String error, String paramsMasked) {
        jdbc.update("INSERT INTO execution_history (kind, query_id, query_name, sql_text, connection_name, environment, status, duration_ms, rows_returned, rows_affected, error_message, params_masked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                kind, queryId, queryName, sql, connection, env, status, durationMs, rowsReturned, rowsAffected,
                error == null ? null : error.substring(0, Math.min(error.length(), 1900)), paramsMasked);
    }

    public List<Map<String, Object>> executions(int limit, String status) {
        int l = Math.min(Math.max(limit, 1), 500);
        if (status != null && !status.isBlank()) {
            return jdbc.queryForList("SELECT * FROM execution_history WHERE status = ? ORDER BY id DESC LIMIT ?", status, l);
        }
        return jdbc.queryForList("SELECT * FROM execution_history ORDER BY id DESC LIMIT ?", l);
    }

    public Map<String, Long> executionCounts() {
        long ok = jdbc.queryForObject("SELECT COUNT(*) FROM execution_history WHERE status = 'SUCCESS'", Long.class);
        long failed = jdbc.queryForObject("SELECT COUNT(*) FROM execution_history WHERE status = 'FAILED'", Long.class);
        return Map.of("successful", ok, "failed", failed);
    }

    // ---- workflow runs ----

    public void upsertRun(String id, Long workflowId, String workflowName, String status, String customer, String contributor,
                          String clientUnique, String paymentMaster, String inputsMasked, String connection, String env,
                          Instant started, Instant finished, Long durationMs, String failedSteps, int rowsAffected,
                          String operations, String error) {
        int n = jdbc.update("UPDATE workflow_run SET status=?, customer_id_masked=?, contributor_id_masked=?, client_unique_id_masked=?, payment_master_id_masked=?, inputs_masked=?, finished_at=?, duration_ms=?, failed_steps=?, rows_affected=?, operations=?, error_message=? WHERE id=?",
                status, customer, contributor, clientUnique, paymentMaster, inputsMasked, ts(finished), durationMs,
                failedSteps, rowsAffected, operations, error, id);
        if (n == 0) {
            jdbc.update("INSERT INTO workflow_run (id, workflow_id, workflow_name, status, customer_id_masked, contributor_id_masked, client_unique_id_masked, payment_master_id_masked, inputs_masked, connection_name, environment, started_at, finished_at, duration_ms, failed_steps, rows_affected, operations, error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    id, workflowId, workflowName, status, customer, contributor, clientUnique, paymentMaster, inputsMasked,
                    connection, env, ts(started), ts(finished), durationMs, failedSteps, rowsAffected, operations, error);
        }
    }

    public void replaceStepRun(String runId, int order, String name, String status, Long durationMs, int attempts,
                               Integer rowsReturned, Integer rowsAffected, String inputsMasked, String error) {
        jdbc.update("DELETE FROM workflow_step_run WHERE run_id = ? AND step_order = ?", runId, order);
        jdbc.update("INSERT INTO workflow_step_run (run_id, step_order, step_name, status, duration_ms, attempts, rows_returned, rows_affected, inputs_masked, error_message) VALUES (?,?,?,?,?,?,?,?,?,?)",
                runId, order, name, status, durationMs, attempts, rowsReturned, rowsAffected, inputsMasked,
                error == null ? null : error.substring(0, Math.min(error.length(), 1900)));
    }

    public List<Map<String, Object>> runs(int limit, String customerMasked) {
        int l = Math.min(Math.max(limit, 1), 500);
        if (customerMasked != null && !customerMasked.isBlank()) {
            return jdbc.queryForList("SELECT * FROM workflow_run WHERE customer_id_masked = ? ORDER BY started_at DESC LIMIT ?", customerMasked, l);
        }
        return jdbc.queryForList("SELECT * FROM workflow_run ORDER BY started_at DESC LIMIT ?", l);
    }

    public List<Map<String, Object>> runById(String id) {
        return jdbc.queryForList("SELECT * FROM workflow_run WHERE id = ?", id);
    }

    public List<Map<String, Object>> stepRuns(String runId) {
        return jdbc.queryForList("SELECT * FROM workflow_step_run WHERE run_id = ? ORDER BY step_order", runId);
    }

    private static Timestamp ts(Instant i) {
        return i == null ? null : Timestamp.from(i);
    }
}
