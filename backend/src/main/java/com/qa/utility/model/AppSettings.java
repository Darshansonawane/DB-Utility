package com.qa.utility.model;

/** Runtime-adjustable guard rails. Defaults are the safest values. */
public record AppSettings(boolean readOnlyMode, int maxResultRows, int queryTimeoutSeconds, int maxAffectedRows,
                          boolean adHocWritesEnabled, boolean maskSensitiveData) {
    public static AppSettings defaults() {
        return new AppSettings(true, 500, 30, 10, false, true);
    }
}
