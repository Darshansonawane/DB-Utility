package com.qa.utility.connection;

/** Decrypted credentials, held only for the moment a connection is opened or tested. Never logged, never returned. */
public record ConnectionSecrets(String password, String uri) {
    @Override
    public String toString() {
        return "ConnectionSecrets[hidden]";
    }
}
