package com.qa.utility.support;

import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.service.TargetDataSourceProvider;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import javax.sql.DataSource;
import java.util.Optional;

/** Replaces the live QA/UAT connection with an isolated in-memory H2 database. Never touches a company database. */
@TestConfiguration
public class TestTargetConfig {
    public static class MutableProvider implements TargetDataSourceProvider {
        private volatile DataSource ds;
        private final ConnectionProfile profile = new ConnectionProfile(1L, "test-conn", "QA", "localhost", 3306, "test", "u", "x");

        public void set(DataSource ds) {
            this.ds = ds;
        }

        @Override
        public DataSource current() {
            if (ds == null) throw ApiException.conflict("Not connected");
            return ds;
        }

        @Override
        public Optional<ConnectionProfile> activeProfile() {
            return ds == null ? Optional.empty() : Optional.of(profile);
        }
    }

    @Bean
    @Primary
    public MutableProvider testProvider() {
        return new MutableProvider();
    }
}
