package com.qa.utility.automation;

import com.qa.utility.exception.ApiException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class ApiDtos {
    private ApiDtos() {
    }

    // ------------------------------------------------------------------ saved API requests

    public record Header(@NotBlank String name, String value) {
    }

    /** source: BODY (JSON path), BODY_REGEX (first capture group), HEADER (name in path), STATUS. */
    public record Extraction(@NotBlank String variable, @NotBlank String source, String path, boolean secret, Long folderId) {
        public Extraction(String variable, String source, String path, boolean secret) {
            this(variable, source, path, secret, null);
        }
    }

    public record ApiRequestDef(Long id, @NotBlank @Size(max = 200) String name, @Size(max = 1000) String description,
                                @NotBlank String method, @NotBlank @Size(max = 2000) String url,
                                @Valid List<Header> headers, String body, @Valid List<Extraction> extractions,
                                Integer expectedStatus, @Size(max = 20000) String preScript, Long folderId) {
        public ApiRequestDef(Long id, String name, String description, String method, String url, List<Header> headers, String body,
                             List<Extraction> extractions, Integer expectedStatus, String preScript) {
            this(id, name, description, method, url, headers, body, extractions, expectedStatus, preScript, null);
        }

        /** Backward-compatible constructor: no pre-request script. */
        public ApiRequestDef(Long id, String name, String description, String method, String url, List<Header> headers, String body,
                             List<Extraction> extractions, Integer expectedStatus) {
            this(id, name, description, method, url, headers, body, extractions, expectedStatus, null, null);
        }

        public ApiRequestDef {
            headers = headers == null ? List.of() : headers;
            extractions = extractions == null ? List.of() : extractions;
        }

        public ApiRequestDef withId(Long newId) {
            return new ApiRequestDef(newId, name, description, method, url, headers, body, extractions, expectedStatus, preScript, folderId);
        }
    }

    public record ExtractedValue(String variable, String value, boolean secret, boolean found) {
    }

    /** What was actually sent (after the pre-request script and variable substitution). Sensitive headers and secrets are masked. */
    public record SentRequest(String method, String url, Map<String, String> headers, String body) {
    }

    public record ApiRunResult(String name, boolean success, Integer status, long durationMs, String resolvedUrl,
                               Map<String, List<String>> headers, String body, boolean bodyTruncated,
                               List<ExtractedValue> extracted, String error, List<String> scriptLog, SentRequest sent) {
    }

    // ------------------------------------------------------------------ step behaviour (shared by API workflows and DB workflows)

    /**
     * A check on a response. source: STATUS | HEADER (name in path) | BODY (JSON path; blank = whole body).
     * operator: EQUALS NOT_EQUALS CONTAINS NOT_CONTAINS EXISTS NOT_EXISTS GREATER_THAN LESS_THAN MATCHES.
     */
    public record Condition(@NotBlank String source, String path, @NotBlank String operator, String value) {
        static final Set<String> SOURCES = Set.of("STATUS", "HEADER", "BODY");
        static final Set<String> OPERATORS = Set.of("EQUALS", "NOT_EQUALS", "CONTAINS", "NOT_CONTAINS", "EXISTS", "NOT_EXISTS",
                "GREATER_THAN", "LESS_THAN", "MATCHES");
    }

    /**
     * waitBeforeSeconds: pause before the first attempt. until: poll the request until every condition holds.
     * maxAttempts/pollIntervalSeconds/pollTimeoutSeconds bound the polling (also used as plain retry when no until is given).
     * assertions: checked once on the accepted response; any failure fails the step.
     */
    public record ApiStepOptions(int waitBeforeSeconds, int pollIntervalSeconds, int pollTimeoutSeconds, int maxAttempts,
                                 @Valid List<Condition> until, @Valid List<Condition> assertions) {
        public ApiStepOptions {
            until = until == null ? List.of() : until;
            assertions = assertions == null ? List.of() : assertions;
        }

        public static ApiStepOptions defaults() {
            return new ApiStepOptions(0, 5, 300, 1, List.of(), List.of());
        }

        /** Applies defaults for unset values and rejects out-of-range ones. */
        public ApiStepOptions normalised() {
            int interval = pollIntervalSeconds <= 0 ? 5 : pollIntervalSeconds;
            int timeout = pollTimeoutSeconds <= 0 ? 300 : pollTimeoutSeconds;
            int attempts = maxAttempts <= 0 ? (until.isEmpty() ? 1 : 60) : maxAttempts;
            if (waitBeforeSeconds < 0 || waitBeforeSeconds > 3600) throw ApiException.badRequest("Wait must be between 0 and 3600 seconds");
            if (interval > 300) throw ApiException.badRequest("Poll interval must be at most 300 seconds");
            if (timeout > 3600) throw ApiException.badRequest("Poll timeout must be at most 3600 seconds");
            if (attempts > 1000) throw ApiException.badRequest("Max attempts must be at most 1000");
            for (Condition c : until) check(c);
            for (Condition c : assertions) check(c);
            return new ApiStepOptions(waitBeforeSeconds, interval, timeout, attempts, until, assertions);
        }

        private static void check(Condition c) {
            if (!Condition.SOURCES.contains(c.source().toUpperCase())) throw ApiException.badRequest("Condition source must be one of " + Condition.SOURCES);
            if (!Condition.OPERATORS.contains(c.operator().toUpperCase())) throw ApiException.badRequest("Condition operator must be one of " + Condition.OPERATORS);
            if (c.source().equalsIgnoreCase("HEADER") && (c.path() == null || c.path().isBlank())) throw ApiException.badRequest("A HEADER condition needs the header name");
        }
    }

    // ------------------------------------------------------------------ API workflows

    /** stepType API_REQUEST (requestId) or SQL_QUERY (queryId + paramValues, saved query: SELECT, or INSERT / UPDATE / DELETE run directly). */
    public record ApiWfStep(Long id, int order, @NotBlank String name, long requestId, String requestName, String requestMethod,
                            String onFailure, boolean enabled, @Valid ApiStepOptions options, String stepType, Long queryId,
                            String queryName, Map<String, String> paramValues) {
        public static final String API = "API_REQUEST";
        public static final String SQL = "SQL_QUERY";

        public ApiWfStep(Long id, int order, String name, long requestId, String requestName, String requestMethod,
                         String onFailure, boolean enabled, ApiStepOptions options) {
            this(id, order, name, requestId, requestName, requestMethod, onFailure, enabled, options, API, null, null, null);
        }

        public boolean isSql() {
            return SQL.equals(stepType);
        }

        public ApiWfStep {
            stepType = SQL.equalsIgnoreCase(stepType) ? SQL : API;
            paramValues = paramValues == null ? Map.of() : paramValues;
            onFailure = onFailure == null || onFailure.isBlank() ? "STOP" : onFailure.toUpperCase();
            options = options == null ? ApiStepOptions.defaults() : options;
        }
    }

    public record ApiWorkflowDef(Long id, @NotBlank @Size(max = 200) String name, @Size(max = 1000) String description,
                                 boolean publishGlobal, int maxRunSeconds, @Valid List<ApiWfStep> steps, Long folderId) {
        public ApiWorkflowDef(Long id, String name, String description, boolean publishGlobal, int maxRunSeconds, List<ApiWfStep> steps) {
            this(id, name, description, publishGlobal, maxRunSeconds, steps, null);
        }

        public ApiWorkflowDef {
            steps = steps == null ? List.of() : steps;
            maxRunSeconds = maxRunSeconds <= 0 ? 1800 : maxRunSeconds;
        }
    }

    public record RunWorkflowRequest(Map<String, String> inputs) {
    }

    public record BatchRunRequest(List<Long> workflowIds, Map<String, String> inputs) {
    }

    public record ApiStepRunView(int order, String name, String requestName, String method, String url, String status, int attempts,
                                 int maxAttempts, Integer httpStatus, Long durationMs, Instant startedAt, Instant finishedAt,
                                 String liveStatus, String error, List<ExtractedValue> extracted, String responseSnippet) {
    }

    public record ApiRunView(String runId, Long workflowId, String workflowName, String status, String triggeredBy, Instant startedAt,
                             Instant finishedAt, Long durationMs, Map<String, String> inputs, String error, List<ApiStepRunView> steps) {
    }

    public record RunSummary(String runId, Long workflowId, String workflowName, String status, String triggeredBy, Instant startedAt,
                             Instant finishedAt, Long durationMs, int totalSteps, int passedSteps, int failedSteps, String error) {
    }

    // ------------------------------------------------------------------ reporting

    public record StepStat(int order, String name, int runs, int failures, double avgMs, long maxMs, double avgAttempts) {
    }

    public record DayStat(String day, int runs, int passed, int failed) {
    }

    public record WorkflowReport(Long workflowId, String workflowName, int days, int totalRuns, int passed, int failed, int cancelled,
                                 int timedOut, double passRate, double avgMs, long minMs, long maxMs, long p95Ms, String lastStatus,
                                 Instant lastRunAt, List<StepStat> steps, List<DayStat> trend, List<RunSummary> recent) {
    }

    public record OverviewRow(Long workflowId, String workflowName, int steps, int runs, double passRate, double avgMs, String lastStatus,
                              Instant lastRunAt) {
    }

    /** scope: GLOBAL (everywhere) | FOLDER (only runs whose request/workflow lives in that folder tree) | ENVIRONMENT (QA, Staging or Development value). */
    public record VariableView(Long id, String name, String value, boolean secret, String source, String sourceType, String sourceName,
                               String scope, long folderId, String folderPath, String environment, Object updatedAt) {
    }

    public record VariableBody(String name, String value, boolean secret, String scope, Long folderId, String environment) {
    }

    public record BulkItem(String name, String value, boolean secret, Long folderId) {
    }

    /** Saves several values at once (the "extract from this response/result" pickers). source e.g. api:Create wallet or sql:myQuery. */
    public record BulkVariables(String source, List<BulkItem> items) {
    }

    public record RunIdsRequest(List<String> runIds) {
    }

    public record TokenInfo(String token, String name, boolean found, String value, String origin, boolean secret) {
    }

    public record PreviewResult(String method, String url, Map<String, String> headers, String body, List<TokenInfo> tokens, boolean ready) {
    }
}
