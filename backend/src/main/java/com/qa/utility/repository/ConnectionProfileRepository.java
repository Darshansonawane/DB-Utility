package com.qa.utility.repository;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
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
            rs.getInt("port"), rs.getString("database_name"), rs.getString("username"), rs.getString("password_encrypted"),
            DbType.parse(rs.getString("db_type")), rs.getString("owner_name"), rs.getString("access_password_hash"),
            rs.getString("uri_encrypted"), rs.getString("auth_database"), rs.getBoolean("tls"));

    public ConnectionProfileRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<ConnectionProfile> findAll() {
        return jdbc.query("SELECT * FROM connection_profile ORDER BY db_type, environment, name", MAPPER);
    }

    public Optional<ConnectionProfile> findById(long id) {
        return jdbc.query("SELECT * FROM connection_profile WHERE id = ?", MAPPER, id).stream().findFirst();
    }

    public ConnectionProfile insert(ConnectionProfile p) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO connection_profile (name, environment, host, port, database_name, username, password_encrypted, "
                            + "db_type, owner_name, access_password_hash, uri_encrypted, auth_database, tls) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, p.name());
            ps.setString(2, p.environment());
            ps.setString(3, p.host());
            ps.setInt(4, p.port());
            ps.setString(5, p.databaseName());
            ps.setString(6, p.username());
            ps.setString(7, p.passwordEncrypted());
            ps.setString(8, p.dbType().name());
            ps.setString(9, p.ownerName());
            ps.setString(10, p.accessPasswordHash());
            ps.setString(11, p.uriEncrypted());
            ps.setString(12, p.authDatabase());
            ps.setBoolean(13, p.tls());
            return ps;
        }, kh);
        long id = ((Number) kh.getKeys().get(kh.getKeys().containsKey("id") ? "id" : kh.getKeys().keySet().iterator().next())).longValue();
        return findById(id).orElseThrow();
    }

    public void update(ConnectionProfile p) {
        jdbc.update("UPDATE connection_profile SET name=?, environment=?, host=?, port=?, database_name=?, username=?, password_encrypted=?, "
                        + "owner_name=?, access_password_hash=?, uri_encrypted=?, auth_database=?, tls=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                p.name(), p.environment(), p.host(), p.port(), p.databaseName(), p.username(), p.passwordEncrypted(),
                p.ownerName(), p.accessPasswordHash(), p.uriEncrypted(), p.authDatabase(), p.tls(), p.id());
    }

    public void setAccessPasswordHash(long id, String hash) {
        jdbc.update("UPDATE connection_profile SET access_password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", hash, id);
    }

    public void delete(long id) {
        jdbc.update("DELETE FROM connection_profile WHERE id = ?", id);
    }
}
