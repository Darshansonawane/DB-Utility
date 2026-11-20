package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.stereotype.Component;

import java.sql.Connection;
import java.sql.DriverManager;
import java.util.Properties;

@Component
public class MySqlAdapter implements DbAdapter {
    @Override
    public DbType type() {
        return DbType.MYSQL;
    }

    public static String jdbcUrl(ConnectionProfile p) {
        return "jdbc:mysql://" + p.host() + ":" + p.port() + "/" + p.databaseName()
                + "?connectTimeout=10000&socketTimeout=120000&allowMultiQueries=false&sslMode=PREFERRED&useUnicode=true&characterEncoding=UTF-8";
    }

    static HikariDataSource buildPool(ConnectionProfile profile, String password) {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(jdbcUrl(profile));
        cfg.setUsername(profile.username());
        cfg.setPassword(password);
        cfg.setCatalog(profile.databaseName()); // lets the pool reset a per-query database switch when a connection is returned
        cfg.setMaximumPoolSize(3);
        cfg.setMinimumIdle(0);
        cfg.setConnectionTimeout(10_000);
        cfg.setPoolName("qa-mysql-" + profile.id() + "-" + System.nanoTime());
        HikariDataSource ds = null;
        try {
            ds = new HikariDataSource(cfg);
            try (Connection c = ds.getConnection()) {
                if (!c.isValid(5)) throw new java.sql.SQLException("Connection validation failed");
            }
            return ds;
        } catch (Exception e) {
            if (ds != null) ds.close();
            throw new IllegalStateException(Errors.root(e), e);
        }
    }

    @Override
    public LiveConnection open(ConnectionProfile profile, ConnectionSecrets secrets) {
        return new MySqlLive(buildPool(profile, secrets.password()), profile, secrets.password());
    }

    @Override
    public Probe probe(ConnectionProfile profile, ConnectionSecrets secrets) throws Exception {
        Properties props = new Properties();
        props.setProperty("user", profile.username());
        props.setProperty("password", secrets.password());
        DriverManager.setLoginTimeout(10);
        long start = System.currentTimeMillis();
        try (Connection c = DriverManager.getConnection(jdbcUrl(profile), props)) {
            return new Probe(System.currentTimeMillis() - start, "MySQL " + c.getMetaData().getDatabaseProductVersion());
        }
    }
}
