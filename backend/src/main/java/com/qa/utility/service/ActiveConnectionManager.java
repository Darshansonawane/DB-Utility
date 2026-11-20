package com.qa.utility.service;

import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Optional;
import java.util.Properties;

/** Owns the one live pool to the selected QA/UAT database. Credentials never leave the backend. */
@Component
public class ActiveConnectionManager implements TargetDataSourceProvider {
    private volatile HikariDataSource pool;
    private volatile ConnectionProfile active;
    /** Kept in memory only (never logged or returned) so the pool can be rebuilt for another database. */
    private volatile String activePassword;

    @Override
    public DataSource current() {
        HikariDataSource p = pool;
        if (p == null) throw ApiException.conflict("Not connected. Open Database Connections and connect to a QA/UAT profile first.");
        return p;
    }

    @Override
    public Optional<ConnectionProfile> activeProfile() {
        return Optional.ofNullable(active);
    }

    public static String jdbcUrl(ConnectionProfile p) {
        return "jdbc:mysql://" + p.host() + ":" + p.port() + "/" + p.databaseName()
                + "?connectTimeout=10000&socketTimeout=120000&allowMultiQueries=false&sslMode=PREFERRED&useUnicode=true&characterEncoding=UTF-8";
    }

    public synchronized void connect(ConnectionProfile profile, String plainPassword) {
        disconnect();
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(jdbcUrl(profile));
        cfg.setUsername(profile.username());
        cfg.setPassword(plainPassword);
        cfg.setCatalog(profile.databaseName()); // lets the pool reset a per-query database switch when a connection is returned
        cfg.setMaximumPoolSize(3);
        cfg.setMinimumIdle(0);
        cfg.setConnectionTimeout(10_000);
        cfg.setPoolName("qa-target-" + profile.name());
        try {
            HikariDataSource ds = new HikariDataSource(cfg);
            try (Connection c = ds.getConnection()) {
                if (!c.isValid(5)) throw new SQLException("Connection validation failed");
            }
            this.pool = ds;
            this.active = profile;
            this.activePassword = plainPassword;
        } catch (Exception e) {
            throw ApiException.badRequest("Could not connect: " + rootMessage(e));
        }
    }

    /** Re-opens the pool on another database of the same server, keeping the same profile and credentials. */
    public synchronized void switchDatabase(String database) {
        ConnectionProfile cur = active;
        String pw = activePassword;
        if (cur == null || pw == null) throw ApiException.conflict("Not connected.");
        HikariDataSource old = pool;
        ConnectionProfile next = new ConnectionProfile(cur.id(), cur.name(), cur.environment(), cur.host(), cur.port(),
                database, cur.username(), cur.passwordEncrypted());
        pool = null;
        active = null;
        if (old != null) old.close();
        try {
            connect(next, pw);
        } catch (RuntimeException e) {
            connect(cur, pw); // fall back to the previous database
            throw e;
        }
    }

    public synchronized void disconnect() {
        if (pool != null) pool.close();
        pool = null;
        active = null;
        activePassword = null;
    }

    /** Opens a throw-away connection (no pool) to verify credentials and reachability. */
    public long test(ConnectionProfile profile, String plainPassword, StringBuilder versionOut) throws SQLException {
        Properties props = new Properties();
        props.setProperty("user", profile.username());
        props.setProperty("password", plainPassword);
        DriverManager.setLoginTimeout(10);
        long start = System.currentTimeMillis();
        try (Connection c = DriverManager.getConnection(jdbcUrl(profile), props)) {
            versionOut.append(c.getMetaData().getDatabaseProductVersion());
            return System.currentTimeMillis() - start;
        }
    }

    public static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    @PreDestroy
    void shutdown() {
        disconnect();
    }
}
