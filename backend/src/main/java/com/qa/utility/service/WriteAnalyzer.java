package com.qa.utility.service;

import com.qa.utility.dto.SqlDtos.Assignment;
import com.qa.utility.model.BoundParam;
import com.qa.utility.security.SqlValidator;
import com.qa.utility.security.SqlValidator.ParsedSql;
import com.qa.utility.security.SqlValidator.StatementType;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/** Derives "which rows will be touched" SELECTs from single-table UPDATE/DELETE statements. */
@Component
public class WriteAnalyzer {
    public record Derived(String selectSql, String countSql, List<BoundParam> selectParams, List<Assignment> assignments) {
    }

    private static final Pattern MULTI_TABLE = Pattern.compile("(?i),|\\bJOIN\\b");
    private static final Pattern DELETE_FROM = Pattern.compile("(?is)^DELETE\\s+FROM\\s+");

    public Optional<Derived> derive(ParsedSql p, List<BoundParam> params) {
        String sql = p.sql();
        String mk = p.masked();
        int whereIdx = SqlValidator.findTopLevel(mk, "WHERE", 0);
        if (whereIdx < 0) return Optional.empty();
        String rest = sql.substring(whereIdx + 5).trim();
        if (p.type() == StatementType.UPDATE) {
            int setIdx = SqlValidator.findTopLevel(mk, "SET", 0);
            if (setIdx < 0 || setIdx > whereIdx) return Optional.empty();
            String table = sql.substring("UPDATE".length(), setIdx).trim();
            if (table.isEmpty() || MULTI_TABLE.matcher(mk.substring("UPDATE".length(), setIdx)).find()) return Optional.empty();
            int skip = count(mk.substring(0, whereIdx));
            if (skip > params.size()) return Optional.empty();
            List<Assignment> assignments = assignments(sql.substring(setIdx + 3, whereIdx), mk.substring(setIdx + 3, whereIdx), params);
            return Optional.of(build(table, rest, params.subList(skip, params.size()), assignments));
        }
        if (p.type() == StatementType.DELETE) {
            var m = DELETE_FROM.matcher(mk);
            if (!m.find()) return Optional.empty();
            String table = sql.substring(m.end(), whereIdx).trim();
            if (table.isEmpty() || MULTI_TABLE.matcher(mk.substring(m.end(), whereIdx)).find()) return Optional.empty();
            return Optional.of(build(table, rest, params, List.of()));
        }
        return Optional.empty();
    }

    private Derived build(String table, String rest, List<BoundParam> params, List<Assignment> assignments) {
        return new Derived("SELECT * FROM " + table + " WHERE " + rest,
                "SELECT COUNT(*) FROM (SELECT 1 FROM " + table + " WHERE " + rest + ") AS preview_cnt",
                List.copyOf(params), assignments);
    }

    private List<Assignment> assignments(String setSql, String setMasked, List<BoundParam> params) {
        List<Assignment> out = new ArrayList<>();
        int depth = 0;
        int start = 0;
        int next = 0;
        for (int i = 0; i <= setMasked.length(); i++) {
            char c = i < setMasked.length() ? setMasked.charAt(i) : ',';
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (c == ',' && depth == 0) {
                String part = setSql.substring(start, i);
                String partMasked = setMasked.substring(start, i);
                start = i + 1;
                int eq = partMasked.indexOf('=');
                if (eq < 0) continue;
                String col = part.substring(0, eq).trim().replace("`", "");
                String rhs = part.substring(eq + 1).trim();
                int n = count(partMasked.substring(eq + 1));
                String value = null;
                if (rhs.equals("?") && next < params.size()) value = params.get(next).raw();
                next += n;
                out.add(new Assignment(col, rhs, value));
            }
        }
        return out;
    }

    static int count(String s) {
        int n = 0;
        for (int i = 0; i < s.length(); i++) if (s.charAt(i) == '?') n++;
        return n;
    }
}
