package com.qa.utility.connection;

public final class Errors {
    private Errors() {
    }

    public static String root(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null && t.getCause() != t) t = t.getCause();
        String m = t.getMessage();
        if (m == null) return t.getClass().getSimpleName();
        // driver messages may echo the connection string: never surface credentials
        return m.replaceAll("(?i)(mongodb(\\+srv)?://)[^@/\\s]+@", "$1***@");
    }
}
