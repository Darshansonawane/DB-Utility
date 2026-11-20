package com.qa.utility.dto;

import com.qa.utility.dto.SqlDtos.QueryResult;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class WorkflowDtos {
    private WorkflowDtos() {
    }

    public record StartRunRequest(Map<String, String> inputs, Map<Integer, Map<String, String>> overrides, List<Integer> steps) {
    }

    public record ExecuteRequest(Map<Integer, Map<String, String>> overrides, List<Integer> steps) {
    }

    public record StepRunView(int order, String name, String description, String queryName, String status, Long durationMs,
                              int attempts, Map<String, String> params, Map<String, String> paramSources,
                              QueryResult result, Map<String, Object> outputs, Integer rowsAffected,
                              String message, String error, List<StepRunView> children) {
        public StepRunView(int order, String name, String description, String queryName, String status, Long durationMs,
                           int attempts, Map<String, String> params, Map<String, String> paramSources,
                           QueryResult result, Map<String, Object> outputs, Integer rowsAffected,
                           String message, String error) {
            this(order, name, description, queryName, status, durationMs, attempts, params, paramSources, result, outputs, rowsAffected,
                    message, error, List.of());
        }
    }

    /** Live run state. Contains real values and rows: held in memory only, never persisted. */
    public record RunView(String runId, Long workflowId, String workflowName, String status, Instant startedAt,
                          Instant finishedAt, Long durationMs, Map<String, String> inputs, List<StepRunView> steps) {
    }
}
