package com.qa.utility.repository;

import com.qa.utility.model.ParamType;
import com.qa.utility.model.QueryExtraction;
import com.qa.utility.model.Workflow;
import com.qa.utility.model.Workflow.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.*;

@Repository
public class WorkflowRepository {
    private final JdbcTemplate jdbc;
    private final com.qa.utility.project.ProjectRepository projects;

    public WorkflowRepository(JdbcTemplate jdbc, com.qa.utility.project.ProjectRepository projects) {
        this.jdbc = jdbc;
        this.projects = projects;
    }

    public List<Workflow> findAll() {
        return jdbc.queryForList("SELECT id FROM workflow ORDER BY name", Long.class).stream().map(id -> findById(id).orElseThrow()).toList();
    }

    public long count() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM workflow", Long.class);
    }

    public Optional<Workflow> findByName(String name) {
        return jdbc.queryForList("SELECT id FROM workflow WHERE name = ?", Long.class, name).stream().findFirst().flatMap(this::findById);
    }

    public Optional<Workflow> findById(long id) {
        return jdbc.query("SELECT * FROM workflow WHERE id = ?", (rs, i) -> new Object[]{rs.getString("name"), rs.getString("description"), rs.getLong("folder_id"), rs.getLong("project_id"),
                        rs.getTimestamp("updated_at") == null ? null : rs.getTimestamp("updated_at").toInstant()}, id)
                .stream().findFirst().map(h -> {
                    List<WorkflowInput> inputs = jdbc.query("SELECT * FROM workflow_input WHERE workflow_id = ? ORDER BY input_order",
                            (r, i) -> new WorkflowInput(r.getString("name"), r.getString("label"), ParamType.valueOf(r.getString("param_type")), r.getBoolean("required"), r.getString("default_value")), id);
                    List<WorkflowStep> steps = jdbc.query(
                            "SELECT s.*, q.name AS query_name, a.name AS api_name, sw.name AS sub_name FROM workflow_step s LEFT JOIN saved_query q ON q.id = s.query_id LEFT JOIN api_request a ON a.id = s.api_request_id LEFT JOIN workflow sw ON sw.id = s.sub_workflow_id WHERE s.workflow_id = ? ORDER BY s.step_order",
                            (r, i) -> {
                                long stepId = r.getLong("id");
                                List<ParamMapping> maps = jdbc.query("SELECT * FROM workflow_param_mapping WHERE step_id = ? ORDER BY id",
                                        (m, j) -> new ParamMapping(m.getString("param_name"), SourceType.valueOf(m.getString("source_type")),
                                                m.getString("source_ref"), m.getString("source_field"), m.getString("constant_value")), stepId);
                                long apiId = r.getLong("api_request_id");
                                Long apiRequestId = r.wasNull() ? null : apiId;
                                long sub = r.getLong("sub_workflow_id");
                                Long subId = r.wasNull() ? null : sub;
                                return new WorkflowStep(stepId, r.getInt("step_order"), r.getString("name"), r.getString("description"),
                                        r.getLong("query_id"), r.getString("query_name"), parseInts(r.getString("depends_on")),
                                        r.getInt("retry_count"), r.getInt("retry_delay_ms"), r.getBoolean("stop_on_failure"),
                                        parseOutputs(r.getString("output_fields")), maps, r.getString("step_type"), apiRequestId,
                                        r.getString("api_name"), parseOptions(r.getString("api_options_json")),
                                        subId, r.getString("sub_name"), readSaves(r.getString("save_variables_json")));
                            }, id);
                    String lastStatus = null;
                    java.time.Instant lastRunAt = null;
                    var last = jdbc.queryForList("SELECT status, started_at FROM workflow_run WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 1", id);
                    if (!last.isEmpty()) {
                        lastStatus = (String) last.get(0).get("STATUS");
                        Object started = last.get(0).get("STARTED_AT");
                        if (started instanceof java.sql.Timestamp t) lastRunAt = t.toInstant();
                    }
                    return new Workflow(id, (String) h[0], (String) h[1], inputs, steps, (Long) h[2], (Long) h[3], (java.time.Instant) h[4], lastStatus, lastRunAt);
                });
    }

    public long insert(Workflow w) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("INSERT INTO workflow (name, description, folder_id, project_id) VALUES (?,?,?,?)", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, w.name());
            ps.setString(2, w.description());
            ps.setLong(3, w.folderId() == null ? 0 : w.folderId());
            ps.setLong(4, w.projectId() == null || w.projectId() == 0 ? projects.defaultProjectId() : w.projectId());
            return ps;
        }, kh);
        long id = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
        saveChildren(id, w);
        return id;
    }

    public void update(long id, Workflow w) {
        jdbc.update("UPDATE workflow SET name=?, description=?, folder_id=?, project_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", w.name(), w.description(),
                w.folderId() == null ? 0 : w.folderId(), w.projectId() == null || w.projectId() == 0 ? projects.defaultProjectId() : w.projectId(), id);
        jdbc.update("DELETE FROM workflow_input WHERE workflow_id = ?", id);
        jdbc.update("DELETE FROM workflow_step WHERE workflow_id = ?", id); // mappings cascade
        saveChildren(id, w);
    }

    public void move(long id, long folderId) {
        jdbc.update("UPDATE workflow SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", folderId, id);
    }

    public void move(long id, long projectId, long folderId) {
        jdbc.update("UPDATE workflow SET project_id = ?, folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", projectId, folderId, id);
    }

    /** Explicitly saves a default value for one input (null/blank clears it). Nothing else about the workflow changes. */
    public void setInputDefault(long workflowId, String inputName, String value) {
        jdbc.update("UPDATE workflow_input SET default_value = ? WHERE workflow_id = ? AND name = ?", value == null || value.isBlank() ? null : value.trim(), workflowId, inputName);
        jdbc.update("UPDATE workflow SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", workflowId);
    }

    public boolean nameTaken(long projectId, String name, long exceptId) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM workflow WHERE project_id = ? AND name = ? AND id <> ?", Integer.class, projectId, name, exceptId) > 0;
    }

    /** Names of the workflows that contain a step running workflow {@code id}. */
    public List<String> usedBy(long id) {
        return jdbc.queryForList("SELECT DISTINCT w.name FROM workflow_step s JOIN workflow w ON w.id = s.workflow_id WHERE s.sub_workflow_id = ? ORDER BY w.name", String.class, id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM workflow WHERE id = ?", id);
    }

    private void saveChildren(long wid, Workflow w) {
        int o = 0;
        for (WorkflowInput in : w.inputs()) {
            jdbc.update("INSERT INTO workflow_input (workflow_id, input_order, name, label, param_type, required, default_value) VALUES (?,?,?,?,?,?,?)",
                    wid, o++, in.name(), in.label(), in.type().name(), in.required(), in.hasDefault() ? in.defaultValue().trim() : null);
        }
        for (WorkflowStep s : w.steps()) {
            KeyHolder kh = new GeneratedKeyHolder();
            jdbc.update(con -> {
                PreparedStatement ps = con.prepareStatement(
                        "INSERT INTO workflow_step (workflow_id, step_order, name, description, query_id, depends_on, retry_count, retry_delay_ms, stop_on_failure, output_fields, step_type, api_request_id, api_options_json, sub_workflow_id, save_variables_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        Statement.RETURN_GENERATED_KEYS);
                ps.setLong(1, wid);
                ps.setInt(2, s.order());
                ps.setString(3, s.name());
                ps.setString(4, s.description());
                if (s.isApi() || s.isWorkflow()) ps.setNull(5, java.sql.Types.BIGINT);
                else ps.setLong(5, s.queryId());
                ps.setString(6, s.dependsOn().stream().map(String::valueOf).reduce((a, b) -> a + "," + b).orElse(""));
                ps.setInt(7, s.retryCount());
                ps.setInt(8, s.retryDelayMs());
                ps.setBoolean(9, s.stopOnFailure());
                ps.setString(10, s.outputFields().stream().map(f -> f.alias() + "=" + f.column()).reduce((a, b) -> a + "," + b).orElse(""));
                ps.setString(11, s.stepType());
                if (s.apiRequestId() == null) ps.setNull(12, java.sql.Types.BIGINT);
                else ps.setLong(12, s.apiRequestId());
                ps.setString(13, options(s));
                if (s.isWorkflow() && s.subWorkflowId() != null) ps.setLong(14, s.subWorkflowId());
                else ps.setNull(14, java.sql.Types.BIGINT);
                ps.setString(15, writeSaves(s.saveVariables()));
                return ps;
            }, kh);
            long stepId = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
            for (ParamMapping m : s.mappings()) {
                jdbc.update("INSERT INTO workflow_param_mapping (step_id, param_name, source_type, source_ref, source_field, constant_value) VALUES (?,?,?,?,?,?)",
                        stepId, m.paramName(), m.sourceType().name(), m.sourceRef(), m.sourceField(), m.constantValue());
            }
        }
    }

    private static String options(WorkflowStep s) {
        if (!s.isApi() || s.apiOptions() == null) return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(s.apiOptions());
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static com.qa.utility.automation.ApiDtos.ApiStepOptions parseOptions(String j) {
        if (j == null || j.isBlank()) return null;
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(j, com.qa.utility.automation.ApiDtos.ApiStepOptions.class);
        } catch (Exception e) {
            return null;
        }
    }

    private static List<Integer> parseInts(String s) {
        if (s == null || s.isBlank()) return List.of();
        return Arrays.stream(s.split(",")).map(String::trim).filter(x -> !x.isEmpty()).map(Integer::valueOf).toList();
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    private static String writeSaves(List<QueryExtraction> l) {
        try {
            return l == null || l.isEmpty() ? null : JSON.writeValueAsString(l);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<QueryExtraction> readSaves(String j) {
        if (j == null || j.isBlank()) return List.of();
        try {
            return JSON.readValue(j, new com.fasterxml.jackson.core.type.TypeReference<List<QueryExtraction>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private static List<OutputField> parseOutputs(String s) {
        if (s == null || s.isBlank()) return List.of();
        List<OutputField> out = new ArrayList<>();
        for (String part : s.split(",")) {
            String p = part.trim();
            if (p.isEmpty()) continue;
            int eq = p.indexOf('=');
            out.add(eq < 0 ? new OutputField(p, p) : new OutputField(p.substring(0, eq).trim(), p.substring(eq + 1).trim()));
        }
        return out;
    }
}
