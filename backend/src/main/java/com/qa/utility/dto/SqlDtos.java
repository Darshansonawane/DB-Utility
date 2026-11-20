package com.qa.utility.dto;

import com.qa.utility.model.ParamType;
import jakarta.validation.constraints.NotBlank;

import java.util.List;
import java.util.Map;

public final class SqlDtos {
    private SqlDtos() {
    }

    public record ParamValue(ParamType type, String value) {
    }

    public record SqlRequest(@NotBlank String sql, List<ParamValue> params, String confirmationToken) {
    }

    public record Column(String name, String type) {
    }

    public record QueryResult(List<Column> columns, List<List<Object>> rows, boolean truncated, int rowCount,
                              Integer affectedRows, long durationMs, String statementType,
                              List<com.qa.utility.automation.ApiDtos.ExtractedValue> extracted) {
        public QueryResult(List<Column> columns, List<List<Object>> rows, boolean truncated, int rowCount,
                           Integer affectedRows, long durationMs, String statementType) {
            this(columns, rows, truncated, rowCount, affectedRows, durationMs, statementType, List.of());
        }

        public QueryResult withExtracted(List<com.qa.utility.automation.ApiDtos.ExtractedValue> e) {
            return new QueryResult(columns, rows, truncated, rowCount, affectedRows, durationMs, statementType, e);
        }

        /** First row as a case-insensitive map; empty when there are no rows. */
        public Map<String, Object> firstRow() {
            Map<String, Object> m = new java.util.TreeMap<>(String.CASE_INSENSITIVE_ORDER);
            if (rows.isEmpty()) return m;
            for (int i = 0; i < columns.size(); i++) m.putIfAbsent(columns.get(i).name(), rows.get(0).get(i));
            return m;
        }
    }

    public record Assignment(String column, String expression, String newValue) {
    }

    public record WritePreview(String statementType, String sql, List<String> params, Long affectedRows,
                               List<Column> columns, List<List<Object>> targetRows, List<Assignment> proposedChanges,
                               boolean previewDerived, int maxAffectedRows, boolean withinLimit, boolean executable,
                               String blockedReason, String confirmationToken, List<String> warnings) {
    }

    public record SqlAnalysis(String statementType, boolean write, int placeholders,
                              List<com.qa.utility.model.QueryParameter> suggestedParameters) {
    }
}
