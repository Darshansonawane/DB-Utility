package com.qa.utility.repository;

import com.qa.utility.model.ConnectionProfile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;
import java.util.Optional;

@Repository
public class ConnectionProfileRepository {
    private final JdbcTemplate jdbc;
    private static final RowMapper<ConnectionProfile> MAPPER = (rs, i) -> new ConnectionProfile(
            rs.getLong("id"), rs.getString("name"), rs.getString("environment"), rs.getString("host"),
            rs.getInt("port"), rs.getString("database_name"), rs.getString("username"), rs.getString("password_encrypted"));

    public ConnectionProfileRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<ConnectionProfile> findAll() {
        return jdbc.query("SELECT * FROM connection_profile ORDER BY environment, name", MAPPER);
    }

    public Optional<ConnectionProfile> findById(long id) {
        return jdbc.query("SELECT * FROM connection_profile WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public ConnectionProfile insert(ConnectionProfile p) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO connection_profile (name, environment, host, port, database_name, username, password_encrypted) VALUES (?,?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, p.name());
            ps.setString(2, p.environment());
            ps.setString(3, p.host());
            ps.setInt(4, p.port());
            ps.setString(5, p.databaseName());
            ps.setString(6, p.username());
            ps.setString(7, p.passwordEncrypted());
            return ps;
        }, kh);
        long id = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
        return findById(id).orElseThrow();
    }

    public void update(ConnectionProfile p) {
        jdbc.update("UPDATE connection_profile SET name=?, environment=?, host=?, port=?, database_name=?, username=?, password_encrypted=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                p.name(), p.environment(), p.host(), p.port(), p.databaseName(), p.username(), p.passwordEncrypted(), p.id());
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM connection_profile WHERE id = ?", id);
    }
}
