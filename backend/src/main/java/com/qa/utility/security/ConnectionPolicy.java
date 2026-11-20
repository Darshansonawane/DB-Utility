package com.qa.utility.security;

import com.qa.utility.config.AppProperties;
import com.qa.utility.exception.ApiException;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.regex.Pattern;

/** Only approved QA/UAT environments, never anything that looks like production. */
@Component
public class ConnectionPolicy {
    private static final Pattern HOST = Pattern.compile("^[A-Za-z0-9._-]{1,253}$");
    private static final Pattern DB = Pattern.compile("^[A-Za-z0-9_$-]{1,64}$");
    private final AppProperties props;

    public ConnectionPolicy(AppProperties props) {
        this.props = props;
    }

    public String normaliseEnvironment(String env) {
        String e = env == null ? "" : env.trim().toUpperCase(Locale.ROOT);
        if (e.equals("DEVELOPMENT")) e = "DEV";
        final String env2 = e;
        if (props.allowedEnvironments().stream().noneMatch(a -> a.equalsIgnoreCase(env2))) {
            throw ApiException.badRequest("Environment '" + env + "' is not approved. Allowed: " + props.allowedEnvironments());
        }
        return e;
    }

    /** Validates a per-query target database name (same rules as a profile's database). */
    public void validateDatabase(String database) {
        if (database == null || !DB.matcher(database).matches()) throw ApiException.badRequest("Invalid database name");
        for (String p : props.blockedHostPatterns()) {
            if (database.toLowerCase(Locale.ROOT).contains(p.toLowerCase(Locale.ROOT))) {
                throw ApiException.badRequest("Database name matches blocked pattern '" + p + "'. This tool is restricted to QA/UAT environments.");
            }
        }
    }

    public void validate(String environment, String host, int port, String database) {
        normaliseEnvironment(environment);
        if (host == null || !HOST.matcher(host).matches()) throw ApiException.badRequest("Invalid host name");
        if (port < 1 || port > 65535) throw ApiException.badRequest("Invalid port");
        if (database == null || !DB.matcher(database).matches()) throw ApiException.badRequest("Invalid database name");
        for (String p : props.blockedHostPatterns()) {
            String pat = p.toLowerCase(Locale.ROOT);
            if (host.toLowerCase(Locale.ROOT).contains(pat) || database.toLowerCase(Locale.ROOT).contains(pat)) {
                throw ApiException.badRequest("Host/database name matches blocked pattern '" + p
                        + "'. This tool is restricted to QA/UAT environments.");
            }
        }
    }
}
