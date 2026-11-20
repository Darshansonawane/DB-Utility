package com.qa.utility.connection;

import com.mongodb.ConnectionString;
import com.mongodb.MongoClientSettings;
import com.mongodb.MongoCredential;
import com.mongodb.ServerAddress;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import org.bson.Document;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.TimeUnit;

@Component
public class MongoAdapter implements DbAdapter {
    @Override
    public DbType type() {
        return DbType.MONGODB;
    }

    static MongoClient build(ConnectionProfile p, ConnectionSecrets s) {
        MongoClientSettings.Builder b = MongoClientSettings.builder()
                .applicationName("FlowNexus")
                .applyToClusterSettings(c -> c.serverSelectionTimeout(10, TimeUnit.SECONDS))
                .applyToSocketSettings(x -> x.connectTimeout(10, TimeUnit.SECONDS).readTimeout(120, TimeUnit.SECONDS))
                .applyToConnectionPoolSettings(x -> x.maxSize(3).minSize(0));
        if (s.uri() != null && !s.uri().isBlank()) {
            b.applyConnectionString(new ConnectionString(s.uri()));
        } else {
            b.applyToClusterSettings(c -> c.hosts(List.of(new ServerAddress(p.host(), p.port()))));
            if (p.username() != null && !p.username().isBlank()) {
                String authDb = p.authDatabase() == null || p.authDatabase().isBlank() ? "admin" : p.authDatabase();
                b.credential(MongoCredential.createCredential(p.username(), authDb, (s.password() == null ? "" : s.password()).toCharArray()));
            }
        }
        if (p.tls()) b.applyToSslSettings(x -> x.enabled(true));
        return MongoClients.create(b.build());
    }

    private static String version(MongoClient c, String db) {
        try {
            return "MongoDB " + c.getDatabase(db).runCommand(new Document("buildInfo", 1)).getString("version");
        } catch (RuntimeException e) {
            return "MongoDB";
        }
    }

    @Override
    public LiveConnection open(ConnectionProfile profile, ConnectionSecrets secrets) {
        MongoClient client = build(profile, secrets);
        try {
            client.getDatabase(profile.databaseName()).runCommand(new Document("ping", 1));
            return new MongoLive(client, profile);
        } catch (RuntimeException e) {
            client.close();
            throw new IllegalStateException(Errors.root(e), e);
        }
    }

    @Override
    public Probe probe(ConnectionProfile profile, ConnectionSecrets secrets) {
        long start = System.currentTimeMillis();
        try (MongoClient client = build(profile, secrets)) {
            client.getDatabase(profile.databaseName()).runCommand(new Document("ping", 1));
            return new Probe(System.currentTimeMillis() - start, version(client, profile.databaseName()));
        }
    }
}
