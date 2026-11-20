package com.qa.utility.model;

public record ConnectionProfile(Long id, String name, String environment, String host, int port,
                                String databaseName, String username, String passwordEncrypted) {
}
