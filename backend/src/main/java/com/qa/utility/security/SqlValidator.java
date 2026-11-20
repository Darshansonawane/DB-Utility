package com.qa.utility.security;

import com.qa.utility.exception.ApiException;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Lexically analyses a single SQL statement: strips comments, rejects multiple statements, executable comments,
 * file/lock/sleep functions and anything that is not SELECT/INSERT/UPDATE/DELETE (plus read-only SHOW/DESCRIBE/EXPLAIN).
 * UPDATE and DELETE must have a top-level WHERE clause.
 */
@Component
public class SqlValidator {

    public enum StatementType {
        SELECT, INSERT, UPDATE, DELETE;

        public boolean isWrite() {
            return this != SELECT;
        }
    }

    /**
     * @param sql    executable SQL (comments removed, trailing semicolon removed)
     * @param masked same length as sql, string/identifier contents blanked: safe for keyword scanning
     */
    public record ParsedSql(String sql, String masked, StatementType type, int placeholders) {
    }

    private static final Pattern FIRST_WORD = Pattern.compile("^\\s*([A-Za-z_]+)");
    private static final Pattern FORBIDDEN = Pattern.compile(
            "\\bINTO\\s+(OUTFILE|DUMPFILE)\\b|\\bLOAD_FILE\\s*\\(|\\bLOAD\\s+DATA\\b|\\b(SLEEP|BENCHMARK|GET_LOCK)\\s*\\(",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern LOCKING = Pattern.compile("\\bFOR\\s+UPDATE\\b|\\bLOCK\\s+IN\\s+SHARE\\s+MODE\\b",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern DML_WORD = Pattern.compile("\\b(INSERT|UPDATE|DELETE)\\b", Pattern.CASE_INSENSITIVE);

    public ParsedSql validate(String raw) {
        if (raw == null || raw.isBlank()) throw ApiException.badRequest("SQL statement is empty");
        StringBuilder clean = new StringBuilder();
        StringBuilder masked = new StringBuilder();
        int n = raw.length();
        int placeholders = 0;
        int i = 0;
        while (i < n) {
            char c = raw.charAt(i);
            if (c == '\'' || c == '"' || c == '`') {
                char q = c;
                clean.append(c);
                masked.append(c);
                i++;
                boolean closed = false;
                while (i < n) {
                    char d = raw.charAt(i);
                    if (d == '\\' && q != '`' && i + 1 < n) {
                        clean.append(d).append(raw.charAt(i + 1));
                        masked.append("xx");
                        i += 2;
                    } else if (d == q) {
                        if (i + 1 < n && raw.charAt(i + 1) == q) {
                            clean.append(d).append(d);
                            masked.append("xx");
                            i += 2;
                        } else {
                            clean.append(d);
                            masked.append(d);
                            i++;
                            closed = true;
                            break;
                        }
                    } else {
                        clean.append(d);
                        masked.append('x');
                        i++;
                    }
                }
                if (!closed) throw ApiException.badRequest("Unterminated quoted string or identifier in SQL");
            } else if (c == '-' && i + 1 < n && raw.charAt(i + 1) == '-'
                    && (i + 2 >= n || Character.isWhitespace(raw.charAt(i + 2)))) {
                while (i < n && raw.charAt(i) != '\n') i++;
                clean.append(' ');
                masked.append(' ');
            } else if (c == '#') {
                while (i < n && raw.charAt(i) != '\n') i++;
                clean.append(' ');
                masked.append(' ');
            } else if (c == '/' && i + 1 < n && raw.charAt(i + 1) == '*') {
                if (i + 2 < n && raw.charAt(i + 2) == '!') {
                    throw ApiException.badRequest("Executable comments (/*! ... */) are not allowed");
                }
                int end = raw.indexOf("*/", i + 2);
                if (end < 0) throw ApiException.badRequest("Unterminated block comment in SQL");
                i = end + 2;
                clean.append(' ');
                masked.append(' ');
            } else {
                if (c == '?') placeholders++;
                clean.append(c);
                masked.append(c);
                i++;
            }
        }
        // trim whitespace and trailing semicolons identically on both buffers
        String m = masked.toString();
        int start = 0;
        int end = m.length();
        while (start < end && Character.isWhitespace(m.charAt(start))) start++;
        while (end > start && (Character.isWhitespace(m.charAt(end - 1)) || m.charAt(end - 1) == ';')) end--;
        if (start >= end) throw ApiException.badRequest("SQL statement is empty");
        String sql = clean.substring(start, end);
        String mk = m.substring(start, end);
        if (mk.indexOf(';') >= 0) {
            throw ApiException.badRequest("Multiple SQL statements are not allowed. Run one statement at a time.");
        }

        Matcher fw = FIRST_WORD.matcher(mk);
        if (!fw.find()) throw ApiException.badRequest("Unable to determine statement type");
        String word = fw.group(1).toUpperCase(Locale.ROOT);
        StatementType type = switch (word) {
            case "SELECT", "SHOW", "DESCRIBE", "DESC", "EXPLAIN" -> StatementType.SELECT;
            case "WITH" -> {
                if (DML_WORD.matcher(mk).find()) throw ApiException.badRequest("Data-modifying WITH statements are not allowed");
                yield StatementType.SELECT;
            }
            case "INSERT" -> StatementType.INSERT;
            case "UPDATE" -> StatementType.UPDATE;
            case "DELETE" -> StatementType.DELETE;
            default -> throw ApiException.badRequest("Statement type '" + word
                    + "' is not allowed. Only SELECT, INSERT, UPDATE and DELETE are permitted.");
        };
        if (FORBIDDEN.matcher(mk).find()) {
            throw ApiException.badRequest("Statement uses a blocked construct (file access, SLEEP, BENCHMARK, GET_LOCK)");
        }
        if (type == StatementType.SELECT && LOCKING.matcher(mk).find()) {
            throw ApiException.badRequest("Locking reads (FOR UPDATE / LOCK IN SHARE MODE) are not allowed");
        }
        if ((type == StatementType.UPDATE || type == StatementType.DELETE) && findTopLevel(mk, "WHERE", 0) < 0) {
            throw ApiException.badRequest(type + " without a WHERE clause is not allowed");
        }
        return new ParsedSql(sql, mk, type, placeholders);
    }

    /** Index of the keyword at parenthesis depth 0, or -1. {@code masked} must come from {@link ParsedSql}. */
    public static int findTopLevel(String masked, String keyword, int from) {
        int depth = 0;
        int k = keyword.length();
        for (int i = from; i <= masked.length() - k; i++) {
            char c = masked.charAt(i);
            if (c == '(') depth++;
            else if (c == ')') depth--;
            else if (depth == 0 && masked.regionMatches(true, i, keyword, 0, k)
                    && (i == 0 || !isWord(masked.charAt(i - 1)))
                    && (i + k >= masked.length() || !isWord(masked.charAt(i + k)))) {
                return i;
            }
        }
        return -1;
    }

    private static boolean isWord(char c) {
        return Character.isLetterOrDigit(c) || c == '_';
    }
}
