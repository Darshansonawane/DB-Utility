package com.qa.utility.service;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.repository.ConnectionProfileRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import javax.sql.DataSource;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Existing UAT data is renamed to Staging on startup without touching credentials or settings. */
@SpringBootTest
class EnvironmentMigrationTest {
    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @Autowired ConnectionProfileRepository repo;

    @Test
    void uatConnectionsQueriesVariablesAndSettingsBecomeStagingAndKeepTheirSecrets() {
        String u = UUID.randomUUID().toString().substring(0, 8);
        jdbc.update("INSERT INTO connection_profile (name, environment, host, port, database_name, username, password_encrypted, access_password_hash) VALUES (?,?,?,?,?,?,?,?)",
                "legacy-uat-" + u, "UAT", "db.staging.internal", 3306, "bank_wallet", "darshan", "v2:ENCRYPTED-BLOB", "pbkdf2$1$a$b");
        jdbc.update("INSERT INTO saved_query (name, sql_text, query_type, environments) VALUES (?,?,?,?)", "legacy-q-" + u, "SELECT 1", "READ", "QA,UAT");
        jdbc.update("INSERT INTO api_variable (name, value_text, scope, scope_key, environment) VALUES (?,?,?,?,?)", "legacy_var_" + u, "x", "ENVIRONMENT", "EUAT", "UAT");
        jdbc.update("MERGE INTO app_setting (setting_key, setting_value) KEY (setting_key) VALUES ('automation.activeEnvironment', 'UAT')");

        // the same script that runs at every startup
        new ResourceDatabasePopulator(new ClassPathResource("metadata-schema.sql")).execute(dataSource);

        ConnectionProfile p = repo.findAll().stream().filter(c -> c.name().equals("legacy-uat-" + u)).findFirst().orElseThrow();
        assertEquals("STAGING", p.environment());
        assertEquals("v2:ENCRYPTED-BLOB", p.passwordEncrypted(), "credentials untouched");
        assertEquals("pbkdf2$1$a$b", p.accessPasswordHash());
        assertEquals("bank_wallet", p.databaseName());
        assertEquals("QA,STAGING", jdbc.queryForObject("SELECT environments FROM saved_query WHERE name = ?", String.class, "legacy-q-" + u));
        assertEquals("STAGING", jdbc.queryForObject("SELECT environment FROM api_variable WHERE name = ?", String.class, "legacy_var_" + u));
        assertEquals("ESTAGING", jdbc.queryForObject("SELECT scope_key FROM api_variable WHERE name = ?", String.class, "legacy_var_" + u));
        assertEquals("STAGING", jdbc.queryForObject("SELECT setting_value FROM app_setting WHERE setting_key = 'automation.activeEnvironment'", String.class));
        // running it again changes nothing
        new ResourceDatabasePopulator(new ClassPathResource("metadata-schema.sql")).execute(dataSource);
        assertEquals("STAGING", repo.findAll().stream().filter(c -> c.name().equals("legacy-uat-" + u)).findFirst().orElseThrow().environment());
    }
}
