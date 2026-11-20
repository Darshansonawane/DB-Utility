package com.qa.utility.dto;

import com.qa.utility.dto.SqlDtos.QueryResult;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class WorkflowDtos {
    private WorkflowDtos() {
    }

    /** Move a workflow: {@code folderId} 0 = directly in the project; {@code projectId} (optional) moves it to another project. */
    public record MoveWorkflow(Long folderId, Long projectId) {
    }

    /** What the Run dialog needs: workflow inputs with defaults, and for every step its parameters, where each value comes from and its default. */
    public record RunForm(List<RunInput> inputs, List<RunStep> steps) {
    }

    public record RunInput(String name, String label, String type, boolean required, String defaultValue) {
    }

    public record RunStep(int order, String name, String stepType, List<RunParam> params) {
    }

    /** {@code sourceKind}: AUTOMATIC (earlier step output), WORKFLOW_INPUT, CONSTANT, DEFAULT (no mapping, has a default) or NONE (nothing provides it). */
    public record RunParam(String name, String label, String type, boolean required, String defaultValue, String sourceKind, String source, String constant, String inputRef) {
    }

    public record InputDefaults(Map<String, String> defaults) {
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
