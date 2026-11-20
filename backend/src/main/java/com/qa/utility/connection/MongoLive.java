package com.qa.utility.connection;

import com.mongodb.client.MongoClient;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import org.bson.Document;

public final class MongoLive implements LiveConnection {
    private final MongoClient client;
    private final ConnectionProfile profile;

    MongoLive(MongoClient client, ConnectionProfile profile) {
        this.client = client;
        this.profile = profile;
    }

    public MongoClient client() {
        return client;
    }

    public String database() {
        return profile.databaseName();
    }

    @Override
    public ConnectionProfile profile() {
        return profile;
    }

    @Override
    public DbType type() {
        return DbType.MONGODB;
    }

    @Override
    public long ping() {
        long t = System.currentTimeMillis();
        client.getDatabase(profile.databaseName()).runCommand(new Document("ping", 1));
        return System.currentTimeMillis() - t;
    }

    @Override
    public void close() {
        client.close();
    }
}
