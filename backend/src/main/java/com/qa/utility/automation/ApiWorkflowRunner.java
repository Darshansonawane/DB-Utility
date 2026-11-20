package com.qa.utility.automation;

import com.qa.utility.audit.AuditService;
import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.security.Masking;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * Runs API workflows asynchronously. Many runs (of the same or different workflows) execute at the same time, each with its
 * own variable scope; at most {@code maxConcurrent} execute concurrently and the rest wait as QUEUED.
 */
@Service
public class ApiWorkflowRunner {
    private static final int KEEP_RUNS_PER_WORKFLOW = 200;
    private static final int MAX_INPUTS = 50;

    static final class StepState {
        final ApiWfStep def;
        volatile String status = "PENDING";
        volatile int attempts;
        volatile int maxAttempts;
        volatile Integer httpStatus;
        volatile Long durationMs;
        volatile Instant startedAt;
        volatile Instant finishedAt;
        volatile String live;
        volatile String error;
        volatile String url;
        volatile String method;
        volatile List<ExtractedValue> extracted = List.of();
        volatile String snippet;

        StepState(ApiWfStep def) {
            this.def = def;
            this.method = def.requestMethod();
            this.maxAttempts = def.options().maxAttempts();
        }

        ApiStepRunView view() {
            return new ApiStepRunView(def.order(), def.name(), def.requestName(), method, url, status, attempts, maxAttempts, httpStatus,
                    durationMs, startedAt, finishedAt, live, error, extracted, snippet);
        }
    }

    static final class RunState {
        final String runId = UUID.randomUUID().toString();
        final ApiWorkflowDef wf;
        final String triggeredBy;
        final Map<String, String> inputsMasked;
        final VarScope scope;
        final Map<Integer, StepState> steps = new LinkedHashMap<>();
        final Instant created = Instant.now();
        volatile Instant started;
        volatile Instant finished;
        volatile String status = "QUEUED";
        volatile boolean cancel;
        volatile String error;

        RunState(ApiWorkflowDef wf, String triggeredBy, Map<String, String> inputsMasked) {
            this.wf = wf;
            this.triggeredBy = triggeredBy;
            this.inputsMasked = inputsMasked;
            this.scope = new VarScope(wf.publishGlobal());
            for (ApiWfStep s : wf.steps()) steps.put(s.order(), new StepState(s));
        }
    }

    private final ApiWorkflowRepository repo;
    private final ApiAutomationRepository requests;
    private final ApiWorkflowService workflows;
    private final ApiStepRunner stepRunner;
    private final VariableService variables;
    private final AuditService audit;
    private final SqlStepRunner sqlSteps;
    private final com.qa.utility.repository.SavedQueryRepository savedQueries;
    private final com.qa.utility.folder.FolderService folders;
    private final int maxConcurrent;
    private final Semaphore permits;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
    private final Map<String, RunState> active = new ConcurrentHashMap<>();

    public ApiWorkflowRunner(ApiWorkflowRepository repo, ApiAutomationRepository requests, ApiWorkflowService workflows, ApiStepRunner stepRunner,
                             VariableService variables, AuditService audit, SqlStepRunner sqlSteps,
                             com.qa.utility.repository.SavedQueryRepository savedQueries, com.qa.utility.folder.FolderService folders,
                             @Value("${qa-utility.api-workflow-max-concurrent:10}") int maxConcurrent) {
        this.repo = repo;
        this.requests = requests;
        this.workflows = workflows;
        this.stepRunner = stepRunner;
        this.variables = variables;
        this.audit = audit;
        this.sqlSteps = sqlSteps;
        this.savedQueries = savedQueries;
        this.folders = folders;
        this.maxConcurrent = Math.max(1, maxConcurrent);
        this.permits = new Semaphore(this.maxConcurrent);
    }

    @PostConstruct
    void markInterrupted() {
        repo.failInterrupted();
    }

    public int maxConcurrent() {
        return maxConcurrent;
    }

    // ------------------------------------------------------------------ start / stop

    public String start(long workflowId, Map<String, String> inputs) {
        ApiWorkflowDef wf = workflows.get(workflowId);
        if (active.size() >= maxConcurrent * 20) throw ApiException.conflict("Too many runs are queued. Wait for some to finish.");
        Map<String, String> in = inputs == null ? Map.of() : inputs;
        if (in.size() > MAX_INPUTS) throw ApiException.badRequest("At most " + MAX_INPUTS + " run variables are allowed");
        Map<String, String> masked = new LinkedHashMap<>();
        in.forEach((k, v) -> {
            VariableService.validateName(k);
            masked.put(k, Masking.mask(v));
        });
        RunState rs = new RunState(wf, System.getProperty("user.name"), masked);
        in.forEach((k, v) -> rs.scope.set(k, v == null ? "" : v, false));
        rs.scope.setBaseFolders(folders.chain(wf.folderId())); // FOLDER-scoped variables of the workflow's folder apply to its steps
        active.put(rs.runId, rs);
        persistRun(rs);
        String sid = com.qa.utility.security.SessionContext.current(); // the run keeps using this browser session's connections
        pool.submit(() -> com.qa.utility.security.SessionContext.runAs(sid, () -> execute(rs)));
        return rs.runId;
    }

    public List<String> startBatch(List<Long> workflowIds, Map<String, String> inputs) {
        if (workflowIds == null || workflowIds.isEmpty()) throw ApiException.badRequest("Select at least one workflow");
        List<String> ids = new ArrayList<>();
        for (Long id : new LinkedHashSet<>(workflowIds)) ids.add(start(id, inputs));
        return ids;
    }

    public ApiRunView cancel(String runId) {
        RunState rs = active.get(runId);
        if (rs == null) throw ApiException.conflict("This run is not active (it has already finished).");
        rs.cancel = true;
        return view(rs);
    }

    // ------------------------------------------------------------------ queries

    public ApiRunView get(String runId) {
        RunState rs = active.get(runId);
        if (rs != null) return view(rs);
        RunSummary s = repo.run(runId).orElseThrow(() -> ApiException.notFound("Run not found"));
        return new ApiRunView(s.runId(), s.workflowId(), s.workflowName(), s.status(), s.triggeredBy(), s.startedAt(), s.finishedAt(), s.durationMs(),
                parseInputs(repo.runInputs(runId)), s.error(), repo.stepRuns(runId));
    }

    public List<RunSummary> activeRuns() {
        return active.values().stream().map(this::summary).sorted(Comparator.comparing(RunSummary::startedAt).reversed()).toList();
    }

    /** Deletes finished runs (all, or one workflow's). Active runs, saved requests, workflows and variables are untouched. */
    public int clearHistory(Long workflowId) {
        int n = repo.deleteFinishedRuns(workflowId);
        audit.record("API_RUNS_CLEARED", null, workflowId == null ? "all workflows" : "workflow " + workflowId, null, n, "SUCCESS", null);
        return n;
    }

    public int deleteRuns(List<String> runIds) {
        if (runIds == null || runIds.isEmpty()) return 0;
        int n = repo.deleteRuns(runIds.stream().filter(id -> !active.containsKey(id)).toList());
        audit.record("API_RUNS_DELETED", null, runIds.size() + " selected", null, n, "SUCCESS", null);
        return n;
    }

    public List<RunSummary> history(Long workflowId, int limit) {
        return repo.runs(workflowId, null, limit);
    }

    // ------------------------------------------------------------------ execution

    private void execute(RunState rs) {
        boolean acquired = false;
        try {
            while (!acquired) {
                if (rs.cancel) {
                    rs.status = "CANCELLED";
                    return;
                }
                acquired = permits.tryAcquire(250, TimeUnit.MILLISECONDS);
            }
            rs.started = Instant.now();
            rs.status = "RUNNING";
            persistRun(rs);
            RunControl control = new RunControl(() -> rs.cancel, System.currentTimeMillis() + rs.wf.maxRunSeconds() * 1000L);
            boolean halted = false;
            for (ApiWfStep def : rs.wf.steps()) {
                StepState ss = rs.steps.get(def.order());
                if (!def.enabled()) {
                    finishStep(rs, ss, "SKIPPED", "Disabled");
                    continue;
                }
                if (halted) {
                    finishStep(rs, ss, "SKIPPED", "Not executed: an earlier step failed and stops the workflow");
                    continue;
                }
                if (control.shouldStop()) {
                    finishStep(rs, ss, control.timedOut() ? "SKIPPED" : "CANCELLED", control.timedOut() ? "Workflow time limit reached" : "Run was stopped before this step");
                    continue;
                }
                ApiStepRunner.Outcome o;
                long t0 = System.nanoTime();
                ss.status = "RUNNING";
                ss.startedAt = Instant.now();
                if (def.isSql()) {
                    com.qa.utility.model.SavedQuery q = savedQueries.findById(def.queryId() == null ? -1 : def.queryId()).orElse(null);
                    if (q == null) {
                        finishStep(rs, ss, "FAILED", "The SQL query for this step no longer exists");
                        if (def.onFailure().equals("STOP")) halted = true;
                        continue;
                    }
                    ss.method = "SQL";
                    ss.url = "DB " + (q.databaseName() == null ? "(active database)" : q.databaseName());
                    try {
                        o = sqlSteps.run(q, def.paramValues(), def.options(), rs.wf.name(), def.name(), rs.scope, control, txt -> ss.live = txt);
                    } catch (RuntimeException e) {
                        o = new ApiStepRunner.Outcome(false, false, false, ss.attempts, ss.maxAttempts, null, "Unexpected error: " + e.getMessage());
                    }
                } else {
                    ApiDtos.ApiRequestDef req = requests.request(def.requestId()).orElse(null);
                    if (req == null) {
                        finishStep(rs, ss, "FAILED", "The API request for this step no longer exists");
                        if (def.onFailure().equals("STOP")) halted = true;
                        continue;
                    }
                    ss.method = req.method();
                    ss.url = req.url();
                    try {
                        o = stepRunner.run(req, def.options(), rs.scope, control, txt -> ss.live = txt);
                    } catch (RuntimeException e) {
                        o = new ApiStepRunner.Outcome(false, false, false, ss.attempts, ss.maxAttempts, null, "Unexpected error: " + e.getMessage());
                    }
                }
                ss.durationMs = Duration.ofNanos(System.nanoTime() - t0).toMillis();
                ss.attempts = o.attempts();
                ss.maxAttempts = o.maxAttempts();
                if (o.last() != null) {
                    ss.httpStatus = o.last().status();
                    ss.url = o.last().resolvedUrl();
                    ss.extracted = o.last().extracted();
                    if (!o.success() && o.last().body() != null) ss.snippet = o.last().body().length() > 2000 ? o.last().body().substring(0, 2000) : o.last().body();
                }
                ss.live = null;
                ss.finishedAt = Instant.now();
                ss.error = o.success() ? null : o.error();
                ss.status = o.success() ? "SUCCESS" : o.cancelled() ? "CANCELLED" : "FAILED";
                repo.replaceStepRun(rs.runId, ss.view());
                if (!o.success() && def.onFailure().equals("STOP")) halted = true;
                persistRun(rs);
            }
            boolean timedOut = control.timedOut();
            boolean anyFailed = rs.steps.values().stream().anyMatch(s -> s.status.equals("FAILED"));
            rs.status = rs.cancel ? "CANCELLED" : timedOut ? "TIMED_OUT" : anyFailed ? "FAILED" : "SUCCESS";
            if (anyFailed) {
                rs.error = rs.steps.values().stream().filter(s -> s.status.equals("FAILED")).findFirst()
                        .map(s -> "Step " + s.def.order() + " (" + s.def.name() + "): " + s.error).orElse(null);
            } else if (timedOut) {
                rs.error = "Workflow time limit of " + rs.wf.maxRunSeconds() + "s reached";
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            rs.status = "CANCELLED";
        } catch (RuntimeException e) {
            rs.status = "FAILED";
            rs.error = "Unexpected error: " + e.getMessage();
        } finally {
            if (acquired) permits.release();
            rs.finished = Instant.now();
            if (rs.started == null) rs.started = rs.created;
            if (rs.status.equals("QUEUED") || rs.status.equals("RUNNING")) rs.status = "FAILED";
            for (StepState s : rs.steps.values()) {
                if (s.status.equals("PENDING") || s.status.equals("RUNNING")) {
                    s.status = "CANCELLED";
                    s.finishedAt = Instant.now();
                    repo.replaceStepRun(rs.runId, s.view());
                }
            }
            persistRun(rs);
            if (rs.wf.id() != null) repo.prune(rs.wf.id(), KEEP_RUNS_PER_WORKFLOW);
            audit.record("API_WORKFLOW_RUN", null, rs.wf.name(), rs.inputsMasked.toString(), null, rs.status, rs.error);
            active.remove(rs.runId);
        }
    }

    private void finishStep(RunState rs, StepState ss, String status, String message) {
        ss.status = status;
        ss.error = status.equals("FAILED") ? message : null;
        ss.live = status.equals("FAILED") ? null : message;
        ss.startedAt = ss.finishedAt = Instant.now();
        ss.durationMs = 0L;
        repo.replaceStepRun(rs.runId, ss.view());
        persistRun(rs);
    }

    private void persistRun(RunState rs) {
        RunSummary s = summary(rs);
        repo.upsertRun(rs.runId, rs.wf.id(), rs.wf.name(), s.status(), rs.triggeredBy, rs.started != null ? rs.started : rs.created, rs.finished, s.durationMs(),
                s.totalSteps(), s.passedSteps(), s.failedSteps(), rs.error, rs.inputsMasked.entrySet().stream().map(e -> e.getKey() + "=" + e.getValue())
                        .collect(Collectors.joining(", ")));
    }

    private RunSummary summary(RunState rs) {
        int passed = (int) rs.steps.values().stream().filter(s -> s.status.equals("SUCCESS")).count();
        int failed = (int) rs.steps.values().stream().filter(s -> s.status.equals("FAILED")).count();
        Instant start = rs.started != null ? rs.started : rs.created;
        Instant end = rs.finished != null ? rs.finished : Instant.now();
        return new RunSummary(rs.runId, rs.wf.id(), rs.wf.name(), rs.status, rs.triggeredBy, start, rs.finished, Duration.between(start, end).toMillis(),
                rs.steps.size(), passed, failed, rs.error);
    }

    private ApiRunView view(RunState rs) {
        Instant start = rs.started != null ? rs.started : rs.created;
        Instant end = rs.finished != null ? rs.finished : Instant.now();
        return new ApiRunView(rs.runId, rs.wf.id(), rs.wf.name(), rs.status, rs.triggeredBy, start, rs.finished, Duration.between(start, end).toMillis(),
                rs.inputsMasked, rs.error, rs.steps.values().stream().map(StepState::view).toList());
    }

    private static Map<String, String> parseInputs(String s) {
        Map<String, String> m = new LinkedHashMap<>();
        if (s == null || s.isBlank()) return m;
        for (String part : s.split(", ")) {
            int i = part.indexOf('=');
            if (i > 0) m.put(part.substring(0, i), part.substring(i + 1));
        }
        return m;
    }
}
