package com.qa.utility.model;

/** Kind of database a connection profile (and a saved query) targets. */
public enum DbType {
    MYSQL, MONGODB;

    public static DbType parse(String s) {
        if (s == null || s.isBlank()) return MYSQL;
        String v = s.trim().toUpperCase(java.util.Locale.ROOT);
        if (v.equals("MONGO")) return MONGODB;
        try {
            return valueOf(v);
        } catch (IllegalArgumentException e) {
            throw com.qa.utility.exception.ApiException.badRequest("Database type must be MYSQL or MONGODB");
        }
    }
}
