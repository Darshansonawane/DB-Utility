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
import java.util.*;

@Repository
public class ApiAutomationRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json = new ObjectMapper();

    public ApiAutomationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- requests
    public List<ApiRequestDef> requests() {
        return jdbc.query("SELECT * FROM api_request ORDER BY name", (rs, i) -> map(rs));
    }

    public Optional<ApiRequestDef> request(long id) {
        return jdbc.query("SELECT * FROM api_request WHERE id = ?", (rs, i) -> map(rs), id).stream().findFirst();
    }

    public long insert(ApiRequestDef r) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO api_request (name, description, method, url, headers_json, body_text, extractions_json, expected_status, pre_script, folder_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            bind(ps, r);
            return ps;
        }, kh);
        return ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
    }

    public void update(long id, ApiRequestDef r) {
        jdbc.update("UPDATE api_request SET name=?, description=?, method=?, url=?, headers_json=?, body_text=?, extractions_json=?, expected_status=?, pre_script=?, folder_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                r.name(), r.description(), r.method(), r.url(), write(r.headers()), r.body(), write(r.extractions()), r.expectedStatus(), r.preScript(), r.folderId() == null ? 0 : r.folderId(), id);
    }

    public boolean requestInUse(long id) {
        Long a = jdbc.queryForObject("SELECT COUNT(*) FROM api_workflow_step WHERE request_id = ?", Long.class, id);
        Long b = jdbc.queryForObject("SELECT COUNT(*) FROM workflow_step WHERE api_request_id = ?", Long.class, id);
        return (a != null && a > 0) || (b != null && b > 0);
    }

    public void deleteRequest(long id) {
        jdbc.update("DELETE FROM api_request WHERE id = ?", id);
    }

    private void bind(PreparedStatement ps, ApiRequestDef r) throws SQLException {
        ps.setString(1, r.name());
        ps.setString(2, r.description());
        ps.setString(3, r.method());
        ps.setString(4, r.url());
        ps.setString(5, write(r.headers()));
        ps.setString(6, r.body());
        ps.setString(7, write(r.extractions()));
        if (r.expectedStatus() == null) ps.setNull(8, java.sql.Types.INTEGER);
        else ps.setInt(8, r.expectedStatus());
        ps.setString(9, r.preScript());
        ps.setLong(10, r.folderId() == null ? 0 : r.folderId());
    }

    private ApiRequestDef map(ResultSet rs) throws SQLException {
        int es = rs.getInt("expected_status");
        Integer expected = rs.wasNull() ? null : es;
        return new ApiRequestDef(rs.getLong("id"), rs.getString("name"), rs.getString("description"), rs.getString("method"),
                rs.getString("url"), read(rs.getString("headers_json"), new TypeReference<List<Header>>() { }), rs.getString("body_text"),
                read(rs.getString("extractions_json"), new TypeReference<List<Extraction>>() { }), expected, rs.getString("pre_script"), rs.getLong("folder_id"));
    }

    // ---- variables (value_text is encrypted by VariableService when secret)
    public record VarRow(Long id, String name, String value, boolean secret, String source, String scope, long folderId,
                         String environment, Object updatedAt) {
    }

    private static final String VAR_COLS = "id, name, value_text, secret, source, scope, folder_id, environment, updated_at";

    private static VarRow varRow(ResultSet rs) throws SQLException {
        return new VarRow(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getString(5), rs.getString(6),
                rs.getLong(7), rs.getString(8), rs.getTimestamp(9));
    }

    public List<VarRow> variables() {
        return jdbc.query("SELECT " + VAR_COLS + " FROM api_variable ORDER BY LOWER(name), scope", (rs, i) -> varRow(rs));
    }

    public List<VarRow> variablesNamed(String name) {
        return jdbc.query("SELECT " + VAR_COLS + " FROM api_variable WHERE name = ?", (rs, i) -> varRow(rs), name);
    }

    public Optional<VarRow> variableById(long id) {
        return jdbc.query("SELECT " + VAR_COLS + " FROM api_variable WHERE id = ?", (rs, i) -> varRow(rs), id).stream().findFirst();
    }

    public Optional<VarRow> variableByKey(String name, String scope, String scopeKey) {
        return jdbc.query("SELECT " + VAR_COLS + " FROM api_variable WHERE name = ? AND scope = ? AND scope_key = ?",
                (rs, i) -> varRow(rs), name, scope, scopeKey).stream().findFirst();
    }

    public void insertVariable(String name, String value, boolean secret, String source, String scope, String scopeKey, long folderId, String env) {
        jdbc.update("INSERT INTO api_variable (name, value_text, secret, source, scope, scope_key, folder_id, environment) VALUES (?,?,?,?,?,?,?,?)",
                name, value, secret, source, scope, scopeKey, folderId, env);
    }

    public void updateVariable(long id, String name, String value, boolean secret, String source, String scope, String scopeKey, long folderId, String env) {
        jdbc.update("UPDATE api_variable SET name=?, value_text=?, secret=?, source=?, scope=?, scope_key=?, folder_id=?, environment=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                name, value, secret, source, scope, scopeKey, folderId, env, id);
    }

    public void deleteVariableById(long id) {
        jdbc.update("DELETE FROM api_variable WHERE id = ?", id);
    }

    public void clearVariables() {
        jdbc.update("DELETE FROM api_variable");
    }

    public String setting(String key) {
        return jdbc.queryForList("SELECT setting_value FROM app_setting WHERE setting_key = ?", String.class, key).stream().findFirst().orElse(null);
    }

    public void putSetting(String key, String value) {
        jdbc.update("MERGE INTO app_setting (setting_key, setting_value) KEY(setting_key) VALUES (?,?)", key, value);
    }

    public void moveRequest(long id, long folderId) {
        jdbc.update("UPDATE api_request SET folder_id = ? WHERE id = ?", folderId, id);
    }

    private String write(Object o) {
        try {
            return json.writeValueAsString(o);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private <T> List<T> read(String s, TypeReference<List<T>> t) {
        if (s == null || s.isBlank()) return List.of();
        try {
            return json.readValue(s, t);
        } catch (Exception e) {
            return List.of();
        }
    }
}
