package com.qa.utility.project;

import com.qa.utility.project.ProjectDtos.ProjectView;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

@Repository
public class ProjectRepository {
    public static final String DEFAULT_NAME = "Default Project";
    private static final String DEFAULT_DESCRIPTION = "Created automatically: workflows and folders without a project live here. Rename it or move them to your own projects.";

    private final JdbcTemplate jdbc;

    public ProjectRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Instant at(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static final String LIST_SQL = "SELECT p.id, p.name, p.description, p.created_at, p.updated_at, "
            + "(SELECT COUNT(*) FROM folder f WHERE f.kind = 'WORKFLOW' AND f.project_id = p.id) AS fc, "
            + "(SELECT COUNT(*) FROM workflow w WHERE w.project_id = p.id) AS wc, "
            + "(SELECT MAX(w.updated_at) FROM workflow w WHERE w.project_id = p.id) AS wu FROM project p";

    private static ProjectView view(java.sql.ResultSet rs) throws java.sql.SQLException {
        Instant created = at(rs.getTimestamp("created_at"));
        Instant updated = at(rs.getTimestamp("updated_at"));
        Instant wu = at(rs.getTimestamp("wu"));
        if (wu != null && (updated == null || wu.isAfter(updated))) updated = wu; // "last updated" also moves when a workflow in it changes
        return new ProjectView(rs.getLong("id"), rs.getString("name"), rs.getString("description"), rs.getInt("fc"), rs.getInt("wc"), created, updated);
    }

    public List<ProjectView> findAll() {
        return jdbc.query(LIST_SQL + " ORDER BY LOWER(p.name)", (rs, i) -> view(rs));
    }

    public Optional<ProjectView> findById(long id) {
        return jdbc.query(LIST_SQL + " WHERE p.id = ?", (rs, i) -> view(rs), id).stream().findFirst();
    }

    public boolean exists(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM project WHERE id = ?", Integer.class, id) > 0;
    }

    public long insert(String name, String description) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("INSERT INTO project (name, description) VALUES (?,?)", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, name);
            ps.setString(2, description);
            return ps;
        }, kh);
        return ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
    }

    public void update(long id, String name, String description) {
        jdbc.update("UPDATE project SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", name, description, id);
    }

    public void touch(long id) {
        jdbc.update("UPDATE project SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM project WHERE id = ?", id);
    }

    /** The project that receives workflows created without one: "Default Project" if it exists, else the oldest project, else a new "Default Project". */
    public synchronized long defaultProjectId() {
        List<Long> named = jdbc.queryForList("SELECT id FROM project WHERE name = ?", Long.class, DEFAULT_NAME);
        if (!named.isEmpty()) return named.get(0);
        List<Long> any = jdbc.queryForList("SELECT id FROM project ORDER BY id", Long.class);
        if (!any.isEmpty()) return any.get(0);
        return insert(DEFAULT_NAME, DEFAULT_DESCRIPTION);
    }
}
