package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;

/** One open, independent connection (its own pool/client, credentials and failure domain). */
public interface LiveConnection {
    ConnectionProfile profile();

    DbType type();

    /** Round-trips to the server; returns the latency in ms or throws when the connection is no longer usable. */
    long ping() throws Exception;

    void close();
}
