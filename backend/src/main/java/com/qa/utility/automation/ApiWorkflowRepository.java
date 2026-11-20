package com.qa.utility.automation;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.qa.utility.automation.ApiDtos.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class ApiWorkflowRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    public ApiWorkflowRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ------------------------------------------------------------------ definitions
    public List<ApiWorkflowDef> findAll() {
        return jdbc.queryForList("SELECT id FROM api_workflow ORDER BY name", Long.class).stream().map(id -> find(id).orElseThrow()).toList();
    }

    public Optional<ApiWorkflowDef> find(long id) {
        return jdbc.query("SELECT * FROM api_workflow WHERE id = ?", (rs, i) -> new Object[]{rs.getString("name"), rs.getString("description"),
                rs.getBoolean("publish_global"), rs.getInt("max_run_seconds"), rs.getLong("folder_id")}, id).stream().findFirst().map(h -> {
            List<ApiWfStep> steps = jdbc.query("SELECT s.*, r.name AS req_name, r.method AS req_method, q.name AS query_name FROM api_workflow_step s "
                    + "LEFT JOIN api_request r ON r.id = s.request_id LEFT JOIN saved_query q ON q.id = s.query_id "
                    + "WHERE s.workflow_id = ? ORDER BY s.step_order", (rs, i) -> step(rs), id);
            return new ApiWorkflowDef(id, (String) h[0], (String) h[1], (Boolean) h[2], (Integer) h[3], steps, (Long) h[4]);
        });
    }

    private ApiWfStep step(ResultSet rs) throws SQLException {
        ApiStepOptions o = null;
        try {
            String j = rs.getString("options_json");
            if (j != null && !j.isBlank()) o = json.readValue(j, ApiStepOptions.class);
        } catch (Exception ignored) {
            // fall back to defaults
        }
        java.util.Map<String, String> pv = java.util.Map.of();
        try {
            String j = rs.getString("param_values_json");
            if (j != null && !j.isBlank()) pv = json.readValue(j, new TypeReference<java.util.Map<String, String>>() { });
        } catch (Exception ignored) {
            // none
        }
        long q = rs.getLong("query_id");
        Long queryId = rs.wasNull() ? null : q;
        return new ApiWfStep(rs.getLong("id"), rs.getInt("step_order"), rs.getString("name"), rs.getLong("request_id"),
                rs.getString("req_name"), rs.getString("req_method"), rs.getString("on_failure"), rs.getBoolean("enabled"), o,
                rs.getString("step_type"), queryId, rs.getString("query_name"), pv);
    }

    public long insert(ApiWorkflowDef w) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("INSERT INTO api_workflow (name, description, publish_global, max_run_seconds, folder_id) VALUES (?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, w.name());
            ps.setString(2, w.description());
            ps.setBoolean(3, w.publishGlobal());
            ps.setInt(4, w.maxRunSeconds());
            ps.setLong(5, w.folderId() == null ? 0 : w.folderId());
            return ps;
        }, kh);
        long id = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
        saveSteps(id, w);
        return id;
    }

    public void update(long id, ApiWorkflowDef w) {
        jdbc.update("UPDATE api_workflow SET name=?, description=?, publish_global=?, max_run_seconds=?, folder_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                w.name(), w.description(), w.publishGlobal(), w.maxRunSeconds(), w.folderId() == null ? 0 : w.folderId(), id);
        jdbc.update("DELETE FROM api_workflow_step WHERE workflow_id = ?", id);
        saveSteps(id, w);
    }

    public void move(long id, long folderId) {
        jdbc.update("UPDATE api_workflow SET folder_id = ? WHERE id = ?", folderId, id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM api_workflow WHERE id = ?", id);
    }

    private void saveSteps(long wid, ApiWorkflowDef w) {
        for (ApiWfStep s : w.steps()) {
            try {
                jdbc.update("INSERT INTO api_workflow_step (workflow_id, step_order, name, request_id, on_failure, enabled, options_json, step_type, query_id, param_values_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        wid, s.order(), s.name(), s.isSql() ? null : s.requestId(), s.onFailure(), s.enabled(), json.writeValueAsString(s.options()),
                        s.stepType(), s.isSql() ? s.queryId() : null, s.isSql() ? json.writeValueAsString(s.paramValues()) : null);
            } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    // ------------------------------------------------------------------ runs
    public void upsertRun(String runId, Long workflowId, String name, String status, String triggeredBy, Instant started, Instant finished,
                          Long durationMs, int total, int passed, int failed, String error, String inputsMasked) {
        int n = jdbc.update("UPDATE api_workflow_run SET status=?, finished_at=?, duration_ms=?, total_steps=?, passed_steps=?, failed_steps=?, error=? WHERE run_id=?",
                status, ts(finished), durationMs, total, passed, failed, trunc(error), runId);
        if (n == 0) {
            jdbc.update("INSERT INTO api_workflow_run (run_id, workflow_id, workflow_name, status, triggered_by, started_at, finished_at, duration_ms, total_steps, passed_steps, failed_steps, error, inputs_masked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    runId, workflowId, name, status, triggeredBy, ts(started), ts(finished), durationMs, total, passed, failed, trunc(error), trunc(inputsMasked));
        }
    }

    public void replaceStepRun(String runId, ApiStepRunView v) {
        jdbc.update("DELETE FROM api_workflow_step_run WHERE run_id = ? AND step_order = ?", runId, v.order());
        String extracted;
        try {
            extracted = json.writeValueAsString(v.extracted() == null ? List.of() : v.extracted());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            extracted = "[]";
        }
        jdbc.update("INSERT INTO api_workflow_step_run (run_id, step_order, step_name, request_name, method, url_display, status, attempts, http_status, duration_ms, started_at, finished_at, error, response_snippet, extracted_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                runId, v.order(), v.name(), v.requestName(), v.method(), trunc(v.url()), v.status(), v.attempts(), v.httpStatus(), v.durationMs(),
                ts(v.startedAt()), ts(v.finishedAt()), trunc(v.error()), v.responseSnippet(), extracted);
    }

    public Optional<RunSummary> run(String runId) {
        return jdbc.query("SELECT * FROM api_workflow_run WHERE run_id = ?", (rs, i) -> summary(rs), runId).stream().findFirst();
    }

    public String runInputs(String runId) {
        return jdbc.queryForList("SELECT inputs_masked FROM api_workflow_run WHERE run_id = ?", String.class, runId).stream().findFirst().orElse(null);
    }

    public List<ApiStepRunView> stepRuns(String runId) {
        return jdbc.query("SELECT * FROM api_workflow_step_run WHERE run_id = ? ORDER BY step_order", (rs, i) -> {
            List<ExtractedValue> ex = List.of();
            try {
                String j = rs.getString("extracted_json");
                if (j != null) ex = json.readValue(j, new TypeReference<List<ExtractedValue>>() { });
            } catch (Exception ignored) {
                // none
            }
            int http = rs.getInt("http_status");
            Integer httpStatus = rs.wasNull() ? null : http;
            return new ApiStepRunView(rs.getInt("step_order"), rs.getString("step_name"), rs.getString("request_name"), rs.getString("method"),
                    rs.getString("url_display"), rs.getString("status"), rs.getInt("attempts"), 0, httpStatus, rs.getLong("duration_ms"),
                    inst(rs.getTimestamp("started_at")), inst(rs.getTimestamp("finished_at")), null, rs.getString("error"), ex,
                    rs.getString("response_snippet"));
        }, runId);
    }

    public List<RunSummary> runs(Long workflowId, Instant since, int limit) {
        StringBuilder sb = new StringBuilder("SELECT * FROM api_workflow_run WHERE 1=1");
        java.util.ArrayList<Object> args = new java.util.ArrayList<>();
        if (workflowId != null) {
            sb.append(" AND workflow_id = ?");
            args.add(workflowId);
        }
        if (since != null) {
            sb.append(" AND started_at >= ?");
            args.add(Timestamp.from(since));
        }
        sb.append(" ORDER BY started_at DESC LIMIT ?");
        args.add(Math.min(Math.max(limit, 1), 5000));
        return jdbc.query(sb.toString(), (rs, i) -> summary(rs), args.toArray());
    }

    public List<java.util.Map<String, Object>> stepRunRows(Long workflowId, Instant since) {
        return jdbc.queryForList("SELECT r.run_id, r.workflow_name, r.started_at AS run_started, r.status AS run_status, s.step_order, s.step_name, s.request_name, s.method, "
                + "s.status AS step_status, s.attempts, s.http_status, s.duration_ms, s.error FROM api_workflow_run r "
                + "LEFT JOIN api_workflow_step_run s ON s.run_id = r.run_id WHERE r.workflow_id = ? AND r.started_at >= ? ORDER BY r.started_at DESC, s.step_order",
                workflowId, Timestamp.from(since));
    }

    /** Keeps the newest {@code keep} runs of a workflow (and their step rows). */
    public void prune(long workflowId, int keep) {
        List<String> old = jdbc.queryForList("SELECT run_id FROM api_workflow_run WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 100000 OFFSET ?",
                String.class, workflowId, keep);
        for (String id : old) {
            jdbc.update("DELETE FROM api_workflow_step_run WHERE run_id = ?", id);
            jdbc.update("DELETE FROM api_workflow_run WHERE run_id = ?", id);
        }
    }

    /** Deletes the given runs (never active ones; the caller filters those) and their step rows. */
    public int deleteRuns(List<String> runIds) {
        int n = 0;
        for (String id : runIds) {
            jdbc.update("DELETE FROM api_workflow_step_run WHERE run_id = ?", id);
            n += jdbc.update("DELETE FROM api_workflow_run WHERE run_id = ? AND status NOT IN ('QUEUED','RUNNING')", id);
        }
        return n;
    }

    public int deleteFinishedRuns(Long workflowId) {
        String where = " WHERE status NOT IN ('QUEUED','RUNNING')" + (workflowId == null ? "" : " AND workflow_id = ?");
        Object[] args = workflowId == null ? new Object[0] : new Object[]{workflowId};
        jdbc.update("DELETE FROM api_workflow_step_run WHERE run_id IN (SELECT run_id FROM api_workflow_run" + where + ")", args);
        return jdbc.update("DELETE FROM api_workflow_run" + where, args);
    }

    public int failInterrupted() {
        return jdbc.update("UPDATE api_workflow_run SET status='FAILED', error='Interrupted: the application was restarted while this run was in progress', finished_at=CURRENT_TIMESTAMP WHERE status IN ('QUEUED','RUNNING')");
    }

    private RunSummary summary(ResultSet rs) throws SQLException {
        long wf = rs.getLong("workflow_id");
        Long wid = rs.wasNull() ? null : wf;
        long d = rs.getLong("duration_ms");
        Long dur = rs.wasNull() ? null : d;
        return new RunSummary(rs.getString("run_id"), wid, rs.getString("workflow_name"), rs.getString("status"), rs.getString("triggered_by"),
                inst(rs.getTimestamp("started_at")), inst(rs.getTimestamp("finished_at")), dur, rs.getInt("total_steps"), rs.getInt("passed_steps"),
                rs.getInt("failed_steps"), rs.getString("error"));
    }

    private static Timestamp ts(Instant i) {
        return i == null ? null : Timestamp.from(i);
    }

    private static Instant inst(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static String trunc(String s) {
        return s == null || s.length() <= 1900 ? s : s.substring(0, 1900);
    }
}
