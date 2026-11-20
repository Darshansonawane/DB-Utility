package com.qa.utility.connection;

import com.mongodb.client.MongoClient;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import org.bson.Document;

public final class MongoLive implements LiveConnection {
    private final MongoClient client;
    private final ConnectionProfile profile;
    private volatile String selected;

    MongoLive(MongoClient client, ConnectionProfile profile) {
        this.client = client;
        this.profile = profile;
        this.selected = profile.databaseName() == null || profile.databaseName().isBlank() ? null : profile.databaseName();
    }

    public MongoClient client() {
        return client;
    }

    public String database() {
        return selected;
    }

    private static final java.util.Set<String> SYSTEM = java.util.Set.of("admin", "local", "config");

    /**
     * listDatabases with authorizedDatabases=true returns only the databases the authenticated user has privileges on, and works even
     * for users without the listDatabases privilege. If the server still refuses, the user can type a database name; the server
     * enforces permissions on every query regardless.
     */
    @Override
    public Discovery discoverDatabases() {
        try {
            Document r = client.getDatabase("admin").runCommand(new Document("listDatabases", 1).append("nameOnly", true).append("authorizedDatabases", true));
            java.util.List<String> names = new java.util.ArrayList<>();
            for (Object o : r.getList("databases", Document.class)) {
                String n = ((Document) o).getString("name");
                if (n != null && !SYSTEM.contains(n)) names.add(n);
            }
            names.sort(String.CASE_INSENSITIVE_ORDER);
            return new Discovery(names, false, names.isEmpty() ? "This user has no accessible databases (MongoDB lists a database once it holds data)." : null);
        } catch (RuntimeException e) {
            return new Discovery(java.util.List.of(), true, "The server did not allow listing databases for this user. Type the database name to use.");
        }
    }

    @Override
    public String selectedDatabase() {
        return selected;
    }

    @Override
    public void selectDatabase(String name) {
        this.selected = name;
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
        client.getDatabase("admin").runCommand(new Document("ping", 1)); // needs no privileges and no chosen database
        return System.currentTimeMillis() - t;
    }

    @Override
    public void close() {
        client.close();
    }
}
