package com.qa.utility.workflow;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads a value out of a step's retained response (an API response body, or {"rowCount":n,"rows":[...]} for a database step) with a
 * simple path: {@code data.items.0.id}, {@code data.items[0].id} or {@code rows.1.customer_id}. Works for any response shape, so no output
 * definition is needed to use a value from an earlier step.
 */
final class StepPaths {
    private static final Pattern SEGMENT = Pattern.compile("^([^\\[\\]]*)((?:\\[\\d+])*)$");
    private static final Pattern INDEX = Pattern.compile("\\[(\\d+)]");
    private static final Pattern NUMBER = Pattern.compile("\\d+");

    private StepPaths() {
    }

    /** The node at {@code path}, or null when any part is missing or null. */
    static JsonNode path(JsonNode root, String path) {
        if (root == null || path == null || path.isBlank()) return null;
        String p = path.startsWith("$.") ? path.substring(2) : path;
        JsonNode cur = root;
        for (String part : p.split("\\.")) {
            Matcher m = SEGMENT.matcher(part);
            if (!m.matches()) return null;
            String name = m.group(1);
            if (!name.isEmpty()) {
                cur = cur.isArray() && NUMBER.matcher(name).matches() ? cur.get(Integer.parseInt(name)) : cur.get(name);
                if (cur == null) return null;
            }
            Matcher idx = INDEX.matcher(m.group(2));
            while (idx.find()) {
                cur = cur.get(Integer.parseInt(idx.group(1)));
                if (cur == null) return null;
            }
        }
        return cur.isNull() || cur.isMissingNode() ? null : cur;
    }

    static String text(JsonNode n) {
        return n.isValueNode() ? n.asText() : n.toString();
    }
}
