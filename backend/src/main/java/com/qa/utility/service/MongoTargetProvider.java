package com.qa.utility.service;

import com.mongodb.client.MongoClient;
import com.qa.utility.model.ConnectionProfile;

import java.util.Optional;

/** Source of the active MongoDB connection (test code supplies an isolated server here). */
public interface MongoTargetProvider {
    /** @throws com.qa.utility.exception.ApiException (409) when no MongoDB connection is active */
    MongoClient client();

    String defaultDatabase();

    Optional<ConnectionProfile> activeProfile();
}
