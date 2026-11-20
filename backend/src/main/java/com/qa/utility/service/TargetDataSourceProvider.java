package com.qa.utility.service;

import com.qa.utility.model.ConnectionProfile;

import javax.sql.DataSource;
import java.util.Optional;

/** Source of the single active QA/UAT connection. Test code supplies an isolated database here. */
public interface TargetDataSourceProvider {
    /** @throws com.qa.utility.exception.ApiException (409) when not connected */
    DataSource current();

    Optional<ConnectionProfile> activeProfile();
}
