package com.qa.utility.automation;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Upgrades an existing metadata store whose api_variable table predates variable scopes and folders, keeping every value.
 * Also guarantees the uniqueness index. Fresh stores already get the new table from metadata-schema.sql.
 */
@Component
public class VariableSchemaMigration {
    private final JdbcTemplate jdbc;

    public VariableSchemaMigration(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void migrate() {
        Integer hasScope = jdbc.queryForObject(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE UPPER(TABLE_NAME) = 'API_VARIABLE' AND UPPER(COLUMN_NAME) = 'SCOPE'", Integer.class);
        if (hasScope != null && hasScope == 0) {
            jdbc.execute("ALTER TABLE api_variable RENAME TO api_variable_legacy");
            jdbc.execute("CREATE TABLE api_variable (id BIGINT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, value_text TEXT, "
                    + "secret BOOLEAN NOT NULL DEFAULT FALSE, source VARCHAR(200), scope VARCHAR(12) NOT NULL DEFAULT 'GLOBAL', "
                    + "scope_key VARCHAR(40) NOT NULL DEFAULT '', folder_id BIGINT NOT NULL DEFAULT 0, environment VARCHAR(10) NOT NULL DEFAULT '', "
                    + "updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
            jdbc.execute("INSERT INTO api_variable (name, value_text, secret, source, updated_at) "
                    + "SELECT name, value_text, secret, source, updated_at FROM api_variable_legacy");
            jdbc.execute("DROP TABLE api_variable_legacy");
        }
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_api_variable_key ON api_variable (name, scope, scope_key)");
    }
}
