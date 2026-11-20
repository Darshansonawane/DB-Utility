package com.qa.utility.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;

public record SavedQuery(
        Long id,
        @NotBlank @Size(max = 200) String name,
        @Size(max = 1000) String description,
        @Size(max = 100) String category,
        @NotBlank String sql,
        QueryType queryType,
        List<String> environments,
        boolean enabled,
        @Size(max = 64) @jakarta.validation.constraints.Pattern(regexp = "^[A-Za-z0-9_$-]*$", message = "Database name may contain letters, digits, _ $ - only") String databaseName,
        @Valid List<QueryParameter> parameters,
        @Valid List<QueryExtraction> extractions,
        DbType engine) {
    public SavedQuery {
        engine = engine == null ? DbType.MYSQL : engine;
        environments = environments == null ? List.of() : environments;
        databaseName = databaseName == null || databaseName.isBlank() ? null : databaseName.trim();
        parameters = parameters == null ? List.of() : parameters;
        extractions = extractions == null ? List.of() : extractions;
    }

    public SavedQuery(Long id, String name, String description, String category, String sql, QueryType queryType,
                      List<String> environments, boolean enabled, String databaseName, List<QueryParameter> parameters,
                      List<QueryExtraction> extractions) {
        this(id, name, description, category, sql, queryType, environments, enabled, databaseName, parameters, extractions, DbType.MYSQL);
    }

    public SavedQuery(Long id, String name, String description, String category, String sql, QueryType queryType,
                      List<String> environments, boolean enabled, String databaseName, List<QueryParameter> parameters) {
        this(id, name, description, category, sql, queryType, environments, enabled, databaseName, parameters, null, DbType.MYSQL);
    }

    /** Backward-compatible constructor: no dedicated database (runs on the active one). */
    public SavedQuery(Long id, String name, String description, String category, String sql, QueryType queryType,
                      List<String> environments, boolean enabled, List<QueryParameter> parameters) {
        this(id, name, description, category, sql, queryType, environments, enabled, null, parameters, null, DbType.MYSQL);
    }

    public SavedQuery withId(Long newId) {
        return new SavedQuery(newId, name, description, category, sql, queryType, environments, enabled, databaseName, parameters, extractions, engine);
    }
}
