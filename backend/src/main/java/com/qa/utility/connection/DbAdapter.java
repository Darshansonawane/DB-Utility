package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;

/** One implementation per database type: opens real, pooled connections and verifies connectivity. */
public interface DbAdapter {
    DbType type();

    /** Opens a long-lived pool/client and verifies it works. Throws on any failure (the caller turns it into a readable message). */
    LiveConnection open(ConnectionProfile profile, ConnectionSecrets secrets) throws Exception;

    /** Throw-away connection used for "Test connection". */
    Probe probe(ConnectionProfile profile, ConnectionSecrets secrets) throws Exception;
}
