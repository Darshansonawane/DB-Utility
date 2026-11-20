package com.qa.utility.service;

import com.qa.utility.exception.ApiException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Pattern;

/** Read-only schema inspection (information_schema) so write operations can be designed from real structures. */
@Service
public class MetadataService {
    private static final Pattern IDENT = Pattern.compile("^[A-Za-z0-9_$]{1,64}$");
    private final TargetDataSourceProvider provider;

    public MetadataService(TargetDataSourceProvider provider) {
        this.provider = provider;
    }

    private JdbcTemplate jdbc() {
        JdbcTemplate t = new JdbcTemplate(provider.current());
        t.setQueryTimeout(30);
        t.setMaxRows(5000);
        return t;
    }

    public List<String> schemas() {
        return jdbc().queryForList("SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY schema_name", String.class);
    }

    public List<Map<String, Object>> tables(String schema) {
        ident(schema);
        return lower(jdbc().queryForList("SELECT table_name, table_type, table_rows, engine FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name", schema));
    }

    public Map<String, Object> table(String schema, String table) {
        ident(schema);
        ident(table);
        JdbcTemplate j = jdbc();
        List<Map<String, Object>> columns = lower(j.queryForList(
                "SELECT column_name, data_type, column_type, is_nullable, column_key, column_default, extra FROM information_schema.columns "
                        + "WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position", schema, table));
        if (columns.isEmpty()) throw ApiException.notFound("Table " + schema + "." + table + " not found");
        List<String> pk = new ArrayList<>();
        for (Map<String, Object> c : columns) if ("PRI".equals(c.get("column_key"))) pk.add(String.valueOf(c.get("column_name")));
        List<Map<String, Object>> fks = lower(j.queryForList(
                "SELECT constraint_name, column_name, referenced_table_schema, referenced_table_name, referenced_column_name "
                        + "FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL "
                        + "ORDER BY constraint_name, ordinal_position", schema, table));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schema", schema);
        out.put("table", table);
        out.put("columns", columns);
        out.put("primaryKey", pk);
        out.put("foreignKeys", fks);
        return out;
    }

    /** Distinct values with counts (e.g. possible status values). Identifiers are verified against information_schema first. */
    public List<Map<String, Object>> distinct(String schema, String table, String column) {
        verifyColumn(schema, table, column);
        return lower(jdbc().queryForList("SELECT `" + column + "` AS value, COUNT(*) AS occurrences FROM `" + schema + "`.`" + table
                + "` GROUP BY `" + column + "` ORDER BY occurrences DESC LIMIT 50"));
    }

    public List<Map<String, Object>> sample(String schema, String table, int limit) {
        ident(schema);
        ident(table);
        table(schema, table); // existence check
        JdbcTemplate j = jdbc();
        j.setMaxRows(Math.min(Math.max(limit, 1), 20));
        return j.queryForList("SELECT * FROM `" + schema + "`.`" + table + "` LIMIT " + Math.min(Math.max(limit, 1), 20));
    }

    private void verifyColumn(String schema, String table, String column) {
        ident(schema);
        ident(table);
        ident(column);
        Integer n = jdbc().queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?",
                Integer.class, schema, table, column);
        if (n == null || n == 0) throw ApiException.notFound("Column " + schema + "." + table + "." + column + " not found");
    }

    private static void ident(String s) {
        if (s == null || !IDENT.matcher(s).matches()) throw ApiException.badRequest("Invalid identifier");
    }

    private static List<Map<String, Object>> lower(List<Map<String, Object>> rows) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            r.forEach((k, v) -> m.put(k.toLowerCase(), v instanceof java.math.BigInteger || v instanceof java.math.BigDecimal ? v.toString() : v));
            out.add(m);
        }
        return out;
    }
}
