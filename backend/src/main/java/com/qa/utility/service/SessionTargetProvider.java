package com.qa.utility.service;

import com.qa.utility.connection.ConnectionRegistry;
import com.qa.utility.connection.MySqlLive;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import org.springframework.stereotype.Component;

import javax.sql.DataSource;
import java.util.Optional;

/** The MySQL connection the current browser session has made active. Other sessions' connections are invisible here. */
@Component
public class SessionTargetProvider implements TargetDataSourceProvider {
    private final ConnectionRegistry registry;

    public SessionTargetProvider(ConnectionRegistry registry) {
        this.registry = registry;
    }

    @Override
    public DataSource current() {
        return registry.active(DbType.MYSQL).map(c -> ((MySqlLive) c).dataSource())
                .orElseThrow(() -> ApiException.conflict("Not connected. Open Database Connections and connect to a QA/UAT MySQL profile first."));
    }

    @Override
    public Optional<ConnectionProfile> activeProfile() {
        return registry.active(DbType.MYSQL).map(c -> c.profile());
    }
}
