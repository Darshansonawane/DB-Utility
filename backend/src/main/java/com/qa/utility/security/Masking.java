package com.qa.utility.security;

import java.util.List;
import java.util.stream.Collectors;

/** Masks identifiers for logs/history: keeps the first and last two characters. */
public final class Masking {
    private Masking() {
    }

    public static String mask(String v) {
        if (v == null || v.isBlank()) return v;
        if (v.length() <= 4) return "****";
        return v.substring(0, 2) + "*".repeat(v.length() - 4) + v.substring(v.length() - 2);
    }

    public static String maskAll(List<String> values) {
        return values.stream().map(Masking::mask).collect(Collectors.joining(", ", "[", "]"));
    }
}
