package com.qa.utility.model;

/**
 * A saved connection. {@code passwordEncrypted} / {@code uriEncrypted} are envelope-encrypted database credentials (never returned
 * by any API). {@code accessPasswordHash} is the hash of the password a person must enter to use this connection.
 */
public record ConnectionProfile(Long id, String name, String environment, String host, int port,
                                String databaseName, String username, String passwordEncrypted,
                                DbType dbType, String ownerName, String accessPasswordHash, String uriEncrypted,
                                String authDatabase, boolean tls) {
    public ConnectionProfile {
        dbType = dbType == null ? DbType.MYSQL : dbType;
    }

    /** MySQL profile without an access password (used by tests and legacy code paths). */
    public ConnectionProfile(Long id, String name, String environment, String host, int port,
                             String databaseName, String username, String passwordEncrypted) {
        this(id, name, environment, host, port, databaseName, username, passwordEncrypted, DbType.MYSQL, null, null, null, null, false);
    }

    public ConnectionProfile withDatabase(String database) {
        return new ConnectionProfile(id, name, environment, host, port, database, username, passwordEncrypted, dbType, ownerName,
                accessPasswordHash, uriEncrypted, authDatabase, tls);
    }

    public boolean passwordProtected() {
        return accessPasswordHash != null && !accessPasswordHash.isBlank();
    }
}
