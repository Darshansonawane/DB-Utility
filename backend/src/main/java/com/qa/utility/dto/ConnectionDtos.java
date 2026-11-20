package com.qa.utility.dto;

import jakarta.validation.constraints.NotBlank;

public final class ConnectionDtos {
    private ConnectionDtos() {
    }

    /**
     * Create / edit / draft-test body. Every secret is write-only: it is accepted here and never returned.
     * <ul>
     *   <li>{@code password}: the database account password (or none for a MongoDB URI that embeds it).</li>
     *   <li>{@code accessPassword}: on create, the password people must enter to use this connection; on edit, the CURRENT access password.</li>
     *   <li>{@code newAccessPassword}: optional, changes the access password when editing.</li>
     * </ul>
     */
    public record ConnectionRequest(
            @NotBlank String name, @NotBlank String environment, String dbType, String host, int port, String databaseName,
            String username, String password, boolean useUri, String uri, String authDatabase, boolean tls, String ownerName,
            String accessPassword, String newAccessPassword) {
    }

    public record AccessRequest(String accessPassword) {
    }

    public record SetAccessPasswordRequest(String newAccessPassword) {
    }

    public record ConnectionView(Long id, String name, String environment, String dbType, String host, int port, String databaseName,
                                 String username, String authDatabase, boolean tls, boolean usesUri, String ownerName,
                                 boolean passwordProtected, boolean connected, boolean active) {
    }

    public record TestResult(boolean success, long latencyMs, String serverVersion, String message) {
    }

    public record StatusView(boolean connected, Long profileId, String connectionName, String environment,
                             String host, String databaseName, Long latencyMs, String message, String dbType, boolean active) {
        public StatusView(boolean connected, Long profileId, String connectionName, String environment,
                          String host, String databaseName, Long latencyMs, String message) {
            this(connected, profileId, connectionName, environment, host, databaseName, latencyMs, message, "MYSQL", connected);
        }
    }

    public record DatabaseList(java.util.List<String> databases, String selected) {
    }

    public record UseDatabaseRequest(@NotBlank String name) {
    }
}
