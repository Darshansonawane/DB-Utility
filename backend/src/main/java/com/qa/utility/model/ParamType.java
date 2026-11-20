package com.qa.utility.model;

import com.qa.utility.exception.ApiException;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;

public enum ParamType {
    STRING, INTEGER, DECIMAL, DATE, DATETIME, BOOLEAN;

    /** Converts user text into a typed JDBC value. Never concatenated into SQL: always bound. */
    public Object convert(String raw, String label) {
        if (raw == null) return null;
        String v = raw.trim();
        try {
            return switch (this) {
                case STRING -> raw;
                case INTEGER -> Long.parseLong(v);
                case DECIMAL -> new BigDecimal(v);
                case DATE -> Date.valueOf(LocalDate.parse(v.length() > 10 ? v.substring(0, 10) : v));
                case DATETIME -> Timestamp.valueOf(LocalDateTime.parse(v.replace(' ', 'T')));
                case BOOLEAN -> {
                    if (v.equalsIgnoreCase("true") || v.equals("1")) yield true;
                    if (v.equalsIgnoreCase("false") || v.equals("0")) yield false;
                    throw new IllegalArgumentException();
                }
            };
        } catch (DateTimeParseException | IllegalArgumentException e) {
            throw ApiException.badRequest("Invalid " + name().toLowerCase() + " value for '" + label + "'");
        }
    }
}
