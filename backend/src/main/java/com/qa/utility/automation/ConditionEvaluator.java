package com.qa.utility.automation;

import com.fasterxml.jackson.databind.JsonNode;
import com.qa.utility.automation.ApiDtos.Condition;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** Evaluates response conditions (poll-until gates and assertions). */
@Component
public class ConditionEvaluator {
    private final VariableService variables;
    private final ApiExecutor executor;

    public ConditionEvaluator(VariableService variables, ApiExecutor executor) {
        this.variables = variables;
        this.executor = executor;
    }

    /** @return empty when the condition holds, otherwise a readable reason. */
    public Optional<String> check(Condition c, ApiExecutor.Exchange x, JsonNode tree, VarScope scope) {
        String op = c.operator().toUpperCase(Locale.ROOT);
        String expected = c.value() == null ? "" : variables.resolve(c.value(), false, scope);
        String actual = actual(c, x, tree);
        String label = describe(c);
        switch (op) {
            case "EXISTS":
                return actual != null && !actual.isEmpty() ? Optional.empty() : Optional.of(label + " is missing");
            case "NOT_EXISTS":
                return actual == null || actual.isEmpty() ? Optional.empty() : Optional.of(label + " exists but should not");
            default:
                break;
        }
        if (actual == null) return Optional.of(label + " is missing (needed " + op.toLowerCase(Locale.ROOT).replace('_', ' ') + " '" + expected + "')");
        boolean ok;
        switch (op) {
            case "EQUALS": ok = actual.equals(expected) || numEq(actual, expected); break;
            case "NOT_EQUALS": ok = !(actual.equals(expected) || numEq(actual, expected)); break;
            case "CONTAINS": ok = actual.contains(expected); break;
            case "NOT_CONTAINS": ok = !actual.contains(expected); break;
            case "GREATER_THAN": ok = cmp(actual, expected) > 0; break;
            case "LESS_THAN": ok = cmp(actual, expected) < 0; break;
            case "MATCHES":
                try {
                    ok = Pattern.compile(expected).matcher(actual).find();
                } catch (RuntimeException e) {
                    return Optional.of("Invalid regex '" + expected + "'");
                }
                break;
            default: return Optional.of("Unknown operator " + op);
        }
        return ok ? Optional.empty() : Optional.of(label + " is '" + shorten(actual) + "' (needed " + op.toLowerCase(Locale.ROOT).replace('_', ' ') + " '" + expected + "')");
    }

    private String actual(Condition c, ApiExecutor.Exchange x, JsonNode tree) {
        String path = c.path() == null ? "" : c.path().trim();
        switch (c.source().toUpperCase(Locale.ROOT)) {
            case "STATUS": return x.status() == null ? null : String.valueOf(x.status());
            case "HEADER": return ApiExecutor.headerValue(x.headers(), path);
            default: {
                if (path.isEmpty()) return x.body();
                if (tree == null) return null;
                JsonNode n = ApiExecutor.jsonPath(tree, path);
                if (n == null || n.isMissingNode() || n.isNull()) return null;
                return n.isValueNode() ? n.asText() : n.toString();
            }
        }
    }

    private static String describe(Condition c) {
        String s = c.source().toUpperCase(Locale.ROOT);
        return s.equals("STATUS") ? "HTTP status" : s.equals("HEADER") ? "Header " + c.path() : c.path() == null || c.path().isBlank() ? "Response body" : "Body " + c.path();
    }

    private static String shorten(String s) {
        return s.length() > 80 ? s.substring(0, 80) + "…" : s;
    }

    private static boolean numEq(String a, String b) {
        try {
            return new BigDecimal(a.trim()).compareTo(new BigDecimal(b.trim())) == 0;
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private static int cmp(String a, String b) {
        try {
            return new BigDecimal(a.trim()).compareTo(new BigDecimal(b.trim()));
        } catch (NumberFormatException e) {
            return a.compareTo(b);
        }
    }
}
