package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;

public final class MySqlLive implements LiveConnection {
    private volatile HikariDataSource pool;
    private volatile ConnectionProfile profile;
    /** Kept in memory only so the pool can be rebuilt on another database of the same server. */
    private final String password;

    MySqlLive(HikariDataSource pool, ConnectionProfile profile, String password) {
        this.pool = pool;
        this.profile = profile;
        this.password = password;
    }

    public DataSource dataSource() {
        return pool;
    }

    @Override
    public ConnectionProfile profile() {
        return profile;
    }

    @Override
    public DbType type() {
        return DbType.MYSQL;
    }

    private static final java.util.Set<String> SYSTEM = java.util.Set.of("information_schema", "mysql", "performance_schema", "sys");

    /** SHOW DATABASES only returns what this MySQL user has privileges on. */
    @Override
    public Discovery discoverDatabases() {
        try {
            java.util.List<String> names = new org.springframework.jdbc.core.JdbcTemplate(pool).queryForList("SHOW DATABASES", String.class).stream()
                    .filter(n -> !SYSTEM.contains(n.toLowerCase(java.util.Locale.ROOT))).sorted(String.CASE_INSENSITIVE_ORDER).toList();
            return new Discovery(names, false, names.isEmpty() ? "This database user has no accessible databases." : null);
        } catch (RuntimeException e) {
            return new Discovery(java.util.List.of(), true, "The server did not allow listing databases: " + Errors.root(e));
        }
    }

    @Override
    public String selectedDatabase() {
        String d = profile.databaseName();
        return d == null || d.isBlank() ? null : d;
    }

    @Override
    public void selectDatabase(String name) {
        switchDatabase(name);
    }

    @Override
    public long ping() throws Exception {
        long t = System.currentTimeMillis();
        try (Connection c = pool.getConnection()) {
            if (!c.isValid(5)) throw new java.sql.SQLException("Connection is no longer valid");
            try (var st = c.createStatement(); var rs = st.executeQuery("SELECT 1")) {
                rs.next();
            }
        }
        return System.currentTimeMillis() - t;
    }

    /** Re-opens the pool on another database; the old pool stays in place if the new one cannot be opened. */
    public synchronized void switchDatabase(String database) {
        ConnectionProfile next = profile.withDatabase(database);
        HikariDataSource fresh = MySqlAdapter.buildPool(next, password);
        HikariDataSource old = pool;
        pool = fresh;
        profile = next;
        if (old != null) old.close();
    }

    @Override
    public void close() {
        HikariDataSource p = pool;
        if (p != null) p.close();
    }
}
