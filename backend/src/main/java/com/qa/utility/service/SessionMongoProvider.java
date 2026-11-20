package com.qa.utility.service;

import com.mongodb.client.MongoClient;
import com.qa.utility.connection.ConnectionRegistry;
import com.qa.utility.connection.MongoLive;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import org.springframework.stereotype.Component;

import java.util.Optional;

@Component
public class SessionMongoProvider implements MongoTargetProvider {
    private final ConnectionRegistry registry;

    public SessionMongoProvider(ConnectionRegistry registry) {
        this.registry = registry;
    }

    private MongoLive live() {
        return registry.active(DbType.MONGODB).map(c -> (MongoLive) c)
                .orElseThrow(() -> ApiException.conflict("No MongoDB connection is active. Open Database Connections and connect to a MongoDB profile first."));
    }

    @Override
    public MongoClient client() {
        return live().client();
    }

    @Override
    public String defaultDatabase() {
        return live().database();
    }

    @Override
    public Optional<ConnectionProfile> activeProfile() {
        return registry.active(DbType.MONGODB).map(c -> c.profile());
    }
}
