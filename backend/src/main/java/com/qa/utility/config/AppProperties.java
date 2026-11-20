package com.qa.utility.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.util.List;

/** Static (startup-time) safety configuration. Runtime-adjustable limits live in {@code AppSettings}. */
@ConfigurationProperties(prefix = "qa-utility")
public record AppProperties(
        @DefaultValue("./.qa-database-utility") String dataDir,
        @DefaultValue({"QA", "UAT"}) List<String> allowedEnvironments,
        @DefaultValue({"prod", "prd", "production", "live"}) List<String> blockedHostPatterns,
        @DefaultValue({"http://localhost:5173", "http://127.0.0.1:5173"}) List<String> corsOrigins,
        @DefaultValue("") String masterKey,
        @DefaultValue("5000") int maxResultRowsCeiling,
        @DefaultValue("100") int maxAffectedRowsCeiling,
        @DefaultValue("120") int queryTimeoutCeilingSeconds,
        @DefaultValue("20") int previewRows,
        @DefaultValue("300") int confirmationTtlSeconds,
        @DefaultValue("50") int runContextCapacity) {
}
