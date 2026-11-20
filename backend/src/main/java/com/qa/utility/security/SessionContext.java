package com.qa.utility.security;

/**
 * Anonymous per-browser session id (no login). Live database connections belong to the browser session that unlocked them, so
 * two people using the same server never share each other's connections. Background threads re-bind it with {@link #runAs}.
 */
public final class SessionContext {
    private static final ThreadLocal<String> CURRENT = new ThreadLocal<>();

    private SessionContext() {
    }

    public static String current() {
        return CURRENT.get();
    }

    public static void set(String sid) {
        if (sid == null) CURRENT.remove();
        else CURRENT.set(sid);
    }

    public static void clear() {
        CURRENT.remove();
    }

    public static void runAs(String sid, Runnable r) {
        String prev = CURRENT.get();
        set(sid);
        try {
            r.run();
        } finally {
            set(prev);
        }
    }
}
