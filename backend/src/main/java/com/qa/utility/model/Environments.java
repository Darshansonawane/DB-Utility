package com.qa.utility.model;

import java.util.Locale;

/** Canonical environment codes: QA, STAGING (formerly UAT), DEV (shown as "Development"). Old spellings are still accepted. */
public final class Environments {
    private Environments() {
    }

    public static String canonical(String raw) {
        String e = raw == null ? "" : raw.trim().toUpperCase(Locale.ROOT);
        return switch (e) {
            case "UAT" -> "STAGING";
            case "DEVELOPMENT" -> "DEV";
            default -> e;
        };
    }
}
