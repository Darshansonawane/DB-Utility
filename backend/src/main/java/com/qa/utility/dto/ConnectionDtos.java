package com.qa.utility.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public final class ConnectionDtos {
    private ConnectionDtos() {
    }

    /** Password is write-only: it is accepted here but never returned. */
    public record ConnectionRequest(
            @NotBlank String name, @NotBlank String environment, @NotBlank String host,
            @Min(1) @Max(65535) int port, @NotBlank String databaseName, @NotBlank String username, String password) {
    }

    public record ConnectionView(Long id, String name, String environment, String host, int port,
                                 String databaseName, String username, boolean active) {
    }

    public record TestResult(boolean success, long latencyMs, String serverVersion, String message) {
    }

    public record StatusView(boolean connected, Long profileId, String connectionName, String environment,
                             String host, String databaseName, Long latencyMs, String message) {
    }

    public record DatabaseList(java.util.List<String> databases, String selected) {
    }

    public record UseDatabaseRequest(@NotBlank String name) {
    }
}
