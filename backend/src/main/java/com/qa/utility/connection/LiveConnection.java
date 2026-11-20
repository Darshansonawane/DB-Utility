package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;

/** One open, independent connection (its own pool/client, credentials and failure domain). */
public interface LiveConnection {
    /** {@code restricted}: the server would not list databases for this user, so {@code names} may be incomplete. */
    record Discovery(java.util.List<String> names, boolean restricted, String message) {
    }

    ConnectionProfile profile();

    DbType type();

    /** Databases this connection's own database user may access (the server decides; nothing is bypassed). */
    Discovery discoverDatabases();

    /** The database queries currently run in, or null when none has been chosen yet. */
    String selectedDatabase();

    /** Switches the working database on this connection only; other connections are untouched. */
    void selectDatabase(String name);

    /** Round-trips to the server; returns the latency in ms or throws when the connection is no longer usable. */
    long ping() throws Exception;

    void close();
}
