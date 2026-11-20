package com.qa.utility.repository;

import com.qa.utility.model.*;
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
public class SavedQueryRepository {
    private final JdbcTemplate jdbc;

    public SavedQueryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<SavedQuery> search(String text, String category) {
        StringBuilder sb = new StringBuilder("SELECT * FROM saved_query WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (text != null && !text.isBlank()) {
            sb.append(" AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(sql_text) LIKE ?)");
            String like = "%" + text.toLowerCase().trim() + "%";
            args.add(like);
            args.add(like);
            args.add(like);
        }
        if (category != null && !category.isBlank()) {
            sb.append(" AND category = ?");
            args.add(category);
        }
        sb.append(" ORDER BY category, name");
        return jdbc.query(sb.toString(), (rs, i) -> map(rs), args.toArray());
    }

    public Optional<SavedQuery> findById(long id) {
        return jdbc.query("SELECT * FROM saved_query WHERE id = ?", (rs, i) -> map(rs), id).stream().findFirst();
    }

    public Optional<SavedQuery> findByName(String name) {
        return jdbc.query("SELECT * FROM saved_query WHERE name = ?", (rs, i) -> map(rs), name).stream().findFirst();
    }

    public long count() {
        return jdbc.queryForObject("SELECT COUNT(*) FROM saved_query", Long.class);
    }

    public List<String> categories() {
        return jdbc.queryForList("SELECT DISTINCT category FROM saved_query WHERE category IS NOT NULL AND category <> '' ORDER BY category", String.class);
    }

    public long insert(SavedQuery q) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO saved_query (name, description, category, sql_text, query_type, environments, enabled, database_name, extractions_json, engine) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, q.name());
            ps.setString(2, q.description());
            ps.setString(3, q.category());
            ps.setString(4, q.sql());
            ps.setString(5, q.queryType().name());
            ps.setString(6, String.join(",", q.environments()));
            ps.setBoolean(7, q.enabled());
            ps.setString(8, q.databaseName());
            ps.setString(9, writeExtractions(q.extractions()));
            ps.setString(10, q.engine().name());
            return ps;
        }, kh);
        long id = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
        saveParams(id, q.parameters());
        return id;
    }

    public void update(long id, SavedQuery q) {
        jdbc.update("UPDATE saved_query SET name=?, description=?, category=?, sql_text=?, query_type=?, environments=?, enabled=?, database_name=?, extractions_json=?, engine=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                q.name(), q.description(), q.category(), q.sql(), q.queryType().name(), String.join(",", q.environments()), q.enabled(), q.databaseName(), writeExtractions(q.extractions()), q.engine().name(), id);
        jdbc.update("DELETE FROM query_parameter WHERE query_id = ?", id);
        saveParams(id, q.parameters());
    }

    /** query id -> folder id, for queries that sit in a folder (0 / missing = Unfiled). */
    public Map<Long, Long> folderAssignments() {
        Map<Long, Long> out = new LinkedHashMap<>();
        jdbc.query("SELECT id, folder_id FROM saved_query WHERE folder_id <> 0", rs -> { out.put(rs.getLong(1), rs.getLong(2)); });
        return out;
    }

    public long folderOf(long id) {
        return jdbc.queryForList("SELECT folder_id FROM saved_query WHERE id = ?", Long.class, id).stream().findFirst().orElse(0L);
    }

    public void setFolder(long id, long folderId) {
        jdbc.update("UPDATE saved_query SET folder_id = ? WHERE id = ?", folderId, id);
    }

    public void setEnabled(long id, boolean enabled) {
        jdbc.update("UPDATE saved_query SET enabled = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?", enabled, id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM saved_query WHERE id = ?", id);
    }

    public boolean usedByWorkflow(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM workflow_step WHERE query_id = ?", Long.class, id) > 0;
    }

    private void saveParams(long queryId, List<QueryParameter> params) {
        int order = 0;
        for (QueryParameter p : params) {
            jdbc.update("INSERT INTO query_parameter (query_id, param_order, name, label, param_type, required, default_value) VALUES (?,?,?,?,?,?,?)",
                    queryId, order++, p.name(), p.label(), p.type().name(), p.required(), p.defaultValue());
        }
    }

    private static final com.fasterxml.jackson.databind.ObjectMapper JSON = new com.fasterxml.jackson.databind.ObjectMapper();

    private static String writeExtractions(List<QueryExtraction> l) {
        try {
            return l == null || l.isEmpty() ? null : JSON.writeValueAsString(l);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    private static List<QueryExtraction> readExtractions(String j) {
        if (j == null || j.isBlank()) return List.of();
        try {
            return JSON.readValue(j, new com.fasterxml.jackson.core.type.TypeReference<List<QueryExtraction>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private SavedQuery map(ResultSet rs) throws SQLException {
        long id = rs.getLong("id");
        String envs = rs.getString("environments");
        List<String> envList = envs == null || envs.isBlank() ? List.of() : Arrays.stream(envs.split(",")).map(String::trim).toList();
        List<QueryParameter> params = jdbc.query("SELECT * FROM query_parameter WHERE query_id = ? ORDER BY param_order",
                (r, i) -> new QueryParameter(r.getString("name"), r.getString("label"), ParamType.valueOf(r.getString("param_type")),
                        r.getBoolean("required"), r.getString("default_value")), id);
        return new SavedQuery(id, rs.getString("name"), rs.getString("description"), rs.getString("category"),
                rs.getString("sql_text"), QueryType.valueOf(rs.getString("query_type")), envList, rs.getBoolean("enabled"), rs.getString("database_name"), params, readExtractions(rs.getString("extractions_json")), DbType.parse(rs.getString("engine")));
    }
}
