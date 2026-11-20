package com.qa.utility.workflow;

import com.qa.utility.automation.ApiAutomationRepository;
import com.qa.utility.automation.ApiDtos.ApiRequestDef;
import com.qa.utility.automation.ApiDtos.ExtractedValue;
import com.qa.utility.automation.ApiStepRunner;
import com.qa.utility.automation.RunControl;
import com.qa.utility.automation.VarScope;
import com.qa.utility.config.AppProperties;
import com.qa.utility.dto.SqlDtos.Column;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.repository.SavedQueryRepository;
import com.qa.utility.security.Masking;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.service.SettingsService;
import com.qa.utility.service.SqlExecutionService;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import com.qa.utility.service.TargetDataSourceProvider;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

/**
 * Generic workflow engine. Steps run saved queries; parameters are resolved from workflow inputs, upstream step
 * outputs (first result row), constants or manual overrides. A step whose required value is missing is BLOCKED rather
 * than run. Full results live only in memory (bounded); persisted history contains masked identifiers and counts.
 */
@Service
public class WorkflowExecutor {
    static final Set<String> DONE = Set.of("SUCCESS", "NO_DATA");

    static final class RunContext {
        final String runId = UUID.randomUUID().toString();
        final Workflow workflow;
        final Map<String, String> inputs;
        final Map<Integer, StepRunView> steps = new ConcurrentHashMap<>();
        final Map<Integer, Map<String, Object>> firstRows = new ConcurrentHashMap<>();
        final Map<Integer, Map<String, String>> overrides = new ConcurrentHashMap<>();
        final AtomicBoolean running = new AtomicBoolean(false);
        final Instant started = Instant.now();
        final ConnectionProfile connection;
        final VarScope scope;
        final RunContext parent;
        final int depth;
        volatile boolean stop;
        volatile String status = "INCOMPLETE";
        volatile Instant finished;

        RunContext(Workflow workflow, Map<String, String> inputs, ConnectionProfile connection, RunContext parent) {
            this.workflow = workflow;
            this.inputs = inputs;
            this.connection = connection;
            this.parent = parent;
            this.depth = parent == null ? 0 : parent.depth + 1;
            this.scope = parent != null ? parent.scope : new VarScope(true); // a nested workflow shares its parent's variables
        }
    }

    private final Map<String, RunContext> store;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
    private final WorkflowService workflows;
    private final SavedQueryRepository queries;
    private final QueryLibraryService library;
    private final SqlExecutionService sql;
    private final HistoryRepository history;
    private final SettingsService settings;
    private final TargetDataSourceProvider provider;
    private final ApiAutomationRepository apiRequests;
    private final ApiStepRunner apiSteps;

    public WorkflowExecutor(AppProperties props, WorkflowService workflows, SavedQueryRepository queries, QueryLibraryService library,
                            SqlExecutionService sql, HistoryRepository history, SettingsService settings, TargetDataSourceProvider provider,
                            ApiAutomationRepository apiRequests, ApiStepRunner apiSteps) {
        this.apiRequests = apiRequests;
        this.apiSteps = apiSteps;
        int cap = Math.max(5, props.runContextCapacity());
        this.store = Collections.synchronizedMap(new LinkedHashMap<>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, RunContext> e) {
                return size() > cap;
            }
        });
        this.workflows = workflows;
        this.queries = queries;
        this.library = library;
        this.sql = sql;
        this.history = history;
        this.settings = settings;
        this.provider = provider;
    }

    // ------------------------------------------------------------------ public API

    /** Creates a run. If {@code steps} is empty every step runs; otherwise only those. Executes asynchronously. */
    public RunView start(long workflowId, Map<String, String> inputs, Map<Integer, Map<String, String>> overrides, List<Integer> steps) {
        RunContext ctx = create(workflowId, inputs);
        Set<Integer> selected = selection(ctx, steps, false);
        mergeOverrides(ctx, overrides);
        launch(ctx, selected);
        return view(ctx);
    }

    /** Executes selected steps (or, when none given, every step that has not completed) on an existing run. */
    public RunView execute(String runId, List<Integer> steps, Map<Integer, Map<String, String>> overrides) {
        RunContext ctx = context(runId);
        if (ctx.running.get()) throw ApiException.conflict("This run is still executing");
        mergeOverrides(ctx, overrides);
        launch(ctx, selection(ctx, steps, true));
        return view(ctx);
    }

    public RunView stop(String runId) {
        RunContext ctx = context(runId);
        ctx.stop = true;
        return view(ctx);
    }

    public RunView get(String runId) {
        return view(context(runId));
    }

    /** Synchronous variant used by tests and by callers that need the finished state. */
    public RunView runNow(long workflowId, Map<String, String> inputs, Map<Integer, Map<String, String>> overrides, List<Integer> steps) {
        RunContext ctx = create(workflowId, inputs);
        mergeOverrides(ctx, overrides);
        Set<Integer> selected = selection(ctx, steps, false);
        ctx.running.set(true);
        runSteps(ctx, selected);
        return view(ctx);
    }

    public RunView executeNow(String runId, List<Integer> steps, Map<Integer, Map<String, String>> overrides) {
        RunContext ctx = context(runId);
        mergeOverrides(ctx, overrides);
        ctx.running.set(true);
        runSteps(ctx, selection(ctx, steps, true));
        return view(ctx);
    }

    // ------------------------------------------------------------------ run lifecycle

    private RunContext create(long workflowId, Map<String, String> inputs) {
        Workflow w = workflows.get(workflowId);
        ConnectionProfile conn = provider.activeProfile()
                .orElseThrow(() -> ApiException.conflict("Not connected. Connect to a QA/UAT database before running a workflow."));
        Map<String, String> in = new LinkedHashMap<>();
        for (WorkflowInput wi : w.inputs()) {
            String v = inputs == null ? null : inputs.get(wi.name());
            if (v != null && !v.isBlank()) {
                wi.type().convert(v, wi.label()); // validate type
                in.put(wi.name(), v.trim());
            }
        }
        RunContext ctx = new RunContext(w, in, conn, null);
        in.forEach((k, v) -> ctx.scope.set(k, v, false)); // workflow inputs are usable as {{name}} in API steps and query values
        store.put(ctx.runId, ctx);
        return ctx;
    }

    private RunContext context(String runId) {
        RunContext c = store.get(runId);
        if (c == null) throw ApiException.notFound("Run not found or its in-memory results expired. Start a new run.");
        return c;
    }

    private Set<Integer> selection(RunContext ctx, List<Integer> steps, boolean pendingOnly) {
        Set<Integer> orders = ctx.workflow.steps().stream().map(WorkflowStep::order).collect(Collectors.toCollection(TreeSet::new));
        if (steps != null && !steps.isEmpty()) {
            for (Integer s : steps) if (!orders.contains(s)) throw ApiException.badRequest("Unknown step " + s);
            return new TreeSet<>(steps);
        }
        if (pendingOnly) {
            orders.removeIf(o -> ctx.steps.get(o) != null && DONE.contains(ctx.steps.get(o).status()));
        }
        return orders;
    }

    private void mergeOverrides(RunContext ctx, Map<Integer, Map<String, String>> overrides) {
        if (overrides == null) return;
        overrides.forEach((order, values) -> {
            Map<String, String> m = ctx.overrides.computeIfAbsent(order, k -> new ConcurrentHashMap<>());
            values.forEach((k, v) -> {
                if (v == null || v.isBlank()) m.remove(k);
                else m.put(k, v.trim());
            });
        });
    }

    private void launch(RunContext ctx, Set<Integer> selected) {
        if (!ctx.running.compareAndSet(false, true)) throw ApiException.conflict("This run is still executing");
        for (Integer o : selected) ctx.steps.remove(o); // shown as PENDING until picked up
        ctx.status = "RUNNING";
        pool.submit(() -> runSteps(ctx, selected));
    }

    void runSteps(RunContext ctx, Set<Integer> selected) {
        try {
            ctx.stop = false;
            ctx.status = "RUNNING";
            ctx.finished = null;
            boolean halted = false;
            String haltReason = null;
            for (WorkflowStep st : ctx.workflow.steps()) {
                if (!selected.contains(st.order())) continue;
                if (halted || stopped(ctx)) {
                    String why = halted ? haltReason : "Run was stopped before this step started";
                    put(ctx, st, simple(st, halted ? "SKIPPED" : "STOPPED", Map.of(), Map.of(), why, null));
                    continue;
                }
                invalidateDownstream(ctx, st.order());
                put(ctx, st, simple(st, "RUNNING", Map.of(), Map.of(), null, null));
                StepRunView v = runStep(ctx, st);
                put(ctx, st, v);
                if ("FAILED".equals(v.status()) && st.stopOnFailure()) {
                    halted = true;
                    haltReason = "Not executed: step " + st.order() + " failed and is configured to stop the workflow";
                }
            }
        } catch (RuntimeException e) {
            ctx.status = "FAILED";
        } finally {
            ctx.status = overallStatus(ctx);
            ctx.finished = Instant.now();
            ctx.running.set(false);
            persistRun(ctx);
        }
    }

    /** A stop request on a run also stops every workflow nested inside it. */
    private static boolean stopped(RunContext c) {
        return c.stop || (c.parent != null && stopped(c.parent));
    }

    private String overallStatus(RunContext ctx) {
        Collection<StepRunView> vs = ctx.steps.values();
        if (vs.stream().anyMatch(v -> "FAILED".equals(v.status()))) return "FAILED";
        if (ctx.stop) return "STOPPED";
        if (vs.stream().anyMatch(v -> "STOPPED".equals(v.status()))) return "STOPPED";
        if (vs.stream().anyMatch(v -> "BLOCKED".equals(v.status()))) return "PARTIAL";
        if (ctx.workflow.steps().stream().anyMatch(s -> !ctx.steps.containsKey(s.order()))) return "INCOMPLETE";
        return "SUCCESS";
    }

    /** Re-running a step makes everything downstream of it stale, so those steps go back to PENDING. */
    private void invalidateDownstream(RunContext ctx, int order) {
        boolean changed = true;
        Set<Integer> stale = new HashSet<>(Set.of(order));
        while (changed) {
            changed = false;
            for (WorkflowStep s : ctx.workflow.steps()) {
                if (stale.contains(s.order())) continue;
                boolean dep = s.dependsOn().stream().anyMatch(stale::contains)
                        || s.mappings().stream().anyMatch(m -> m.sourceType() == SourceType.STEP_OUTPUT && stale.contains(parse(m.sourceRef())));
                if (dep) {
                    stale.add(s.order());
                    changed = true;
                }
            }
        }
        stale.remove(order);
        for (Integer s : stale) {
            StepRunView v = ctx.steps.get(s);
            if (v != null && !"RUNNING".equals(v.status())) {
                ctx.steps.remove(s);
                ctx.firstRows.remove(s);
            }
        }
    }

    // ------------------------------------------------------------------ single step

    private StepRunView runStep(RunContext ctx, WorkflowStep st) {
        long t0 = System.nanoTime();
        if (st.isApi()) return runApiStep(ctx, st, t0);
        if (st.isWorkflow()) return runSubWorkflow(ctx, st, t0);
        Map<String, String> ov = ctx.overrides.getOrDefault(st.order(), Map.of());
        SavedQuery q = queries.findById(st.queryId()).orElse(null);
        if (q == null) return simple(st, "FAILED", Map.of(), Map.of(), null, "The query for this step no longer exists");

        boolean fullyOverridden = !q.parameters().isEmpty() && q.parameters().stream()
                .filter(QueryParameter::required).allMatch(p -> ov.containsKey(p.name()));
        if (!fullyOverridden) {
            for (int dep : st.dependsOn()) {
                StepRunView dv = ctx.steps.get(dep);
                if (dv == null || !DONE.contains(dv.status())) {
                    String name = dv == null ? "not run yet" : dv.status();
                    return blocked(st, Map.of(), Map.of(), "Upstream step " + dep + " has not completed successfully (" + name + "). Run it first or provide the value manually.");
                }
            }
        }

        Map<String, String> params = new LinkedHashMap<>();
        Map<String, String> sources = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (QueryParameter p : q.parameters()) {
            String manual = ov.get(p.name());
            if (manual != null) {
                params.put(p.name(), manual);
                sources.put(p.name(), "Manual override");
                continue;
            }
            Optional<ParamMapping> mapping = st.mappings().stream().filter(m -> m.paramName().equals(p.name())).findFirst();
            if (mapping.isPresent()) {
                Resolved r = resolve(ctx, mapping.get());
                if (r.value != null) {
                    params.put(p.name(), r.value);
                    sources.put(p.name(), r.source);
                } else {
                    sources.put(p.name(), r.source);
                    missing.add(p.label() + ": " + r.problem);
                }
            } else if (p.defaultValue() != null && !p.defaultValue().isBlank()) {
                params.put(p.name(), p.defaultValue());
                sources.put(p.name(), "Default value");
            } else if (p.required()) {
                missing.add(p.label() + ": no mapping configured");
            }
        }
        if (!missing.isEmpty()) {
            return blocked(st, params, sources, "Missing required value(s) - " + String.join("; ", missing));
        }

        if (q.queryType() == QueryType.WRITE) {
            return simple(st, "FAILED", params, sources, null,
                    "Write queries are not executed by the workflow engine: they require a preview and explicit confirmation. Run it from Saved Queries.");
        }
        List<BoundParam> bound;
        try {
            library.checkRunnable(q);
            bound = library.bind(q, params, ctx.scope);
        } catch (ApiException e) {
            return simple(st, "FAILED", params, sources, null, e.getMessage());
        }

        int attempts = 0;
        int max = 1 + st.retryCount();
        QueryResult res = null;
        String error = null;
        while (attempts < max) {
            attempts++;
            try {
                res = sql.execute(q.sql(), bound, null, ExecContext.workflow(q.id(), ctx.workflow.name() + " / " + st.name(), q.databaseName()));
                error = null;
                break;
            } catch (ApiException e) {
                error = e.getMessage();
                if (attempts < max) {
                    try {
                        Thread.sleep(Math.max(0, st.retryDelayMs()));
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        long ms = Duration.ofNanos(System.nanoTime() - t0).toMillis();
        if (res == null) {
            return new StepRunView(st.order(), st.name(), st.description(), q.name(), "FAILED", ms, attempts, params, sources, null,
                    Map.of(), null, null, error);
        }
        Map<String, Object> first = res.firstRow();
        ctx.firstRows.put(st.order(), first);
        QueryLibraryService.ExtractionOutcome extractedVars = library.applyExtractions(q, res, ctx.scope);
        if (!extractedVars.values().isEmpty()) res = res.withExtracted(extractedVars.values());
        Map<String, Object> outputs = new LinkedHashMap<>();
        List<String> warnings = new ArrayList<>();
        if (res.rowCount() > 0) {
            for (OutputField f : st.outputFields()) {
                if (first.containsKey(f.column())) outputs.put(f.alias(), first.get(f.column()));
                else warnings.add("Output '" + f.alias() + "': column '" + f.column() + "' not found (available: " + String.join(", ", first.keySet()) + ")");
            }
        }
        warnings.addAll(extractedVars.problems());
        String status = res.rowCount() == 0 ? "NO_DATA" : "SUCCESS";
        String message = res.rowCount() == 0 ? "No records found for the given input(s)."
                : (res.rowCount() > 1 ? res.rowCount() + " rows returned; outputs are taken from the first row. " : "")
                + String.join(" ", warnings);
        return new StepRunView(st.order(), st.name(), st.description(), q.name(), status, ms, attempts, params, sources, res,
                outputs, null, message.isBlank() ? null : message.trim(), null);
    }

    private static final int MAX_NESTING = 5;

    /**
     * A workflow step: runs another saved workflow inline, sharing this run's database connection and variables. The child's
     * inputs come from this step's mappings (workflow input / earlier step output / constant) or a manual override; the child's
     * step outputs become this step's outputs, so later steps can use them.
     */
    private StepRunView runSubWorkflow(RunContext ctx, WorkflowStep st, long t0) {
        String label = "Workflow: " + (st.subWorkflowName() == null ? "#" + st.subWorkflowId() : st.subWorkflowName());
        Workflow child;
        try {
            child = workflows.get(st.subWorkflowId() == null ? -1 : st.subWorkflowId());
        } catch (ApiException e) {
            return simple(st, "FAILED", Map.of(), Map.of(), null, "The workflow for this step no longer exists");
        }
        label = "Workflow: " + child.name();
        if (ctx.depth + 1 > MAX_NESTING) return simple(st, "FAILED", Map.of(), Map.of(), null, "Workflows are nested more than " + MAX_NESTING + " levels deep");
        for (int dep : st.dependsOn()) {
            StepRunView dv = ctx.steps.get(dep);
            if (dv == null || !DONE.contains(dv.status())) {
                return blocked(st, Map.of(), Map.of(), "Upstream step " + dep + " has not completed successfully (" + (dv == null ? "not run yet" : dv.status()) + "). Run it first.");
            }
        }
        Map<String, String> ov = ctx.overrides.getOrDefault(st.order(), Map.of());
        Map<String, String> inputs = new LinkedHashMap<>();
        Map<String, String> sources = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (WorkflowInput wi : child.inputs()) {
            if (ov.containsKey(wi.name())) {
                inputs.put(wi.name(), ov.get(wi.name()));
                sources.put(wi.name(), "Manual override");
                continue;
            }
            Optional<ParamMapping> mapping = st.mappings().stream().filter(m -> m.paramName().equals(wi.name())).findFirst();
            if (mapping.isPresent()) {
                Resolved r = resolve(ctx, mapping.get());
                sources.put(wi.name(), r.source);
                if (r.value != null) inputs.put(wi.name(), r.value);
                else if (wi.required()) missing.add(wi.label() + ": " + r.problem);
            } else if (wi.required()) {
                missing.add(wi.label() + ": no mapping configured");
            }
        }
        if (!missing.isEmpty()) return blocked(st, inputs, sources, "Missing required value(s) for " + child.name() + " - " + String.join("; ", missing));
        for (WorkflowInput wi : child.inputs()) {
            String v = inputs.get(wi.name());
            if (v != null) {
                try {
                    wi.type().convert(v, wi.label());
                } catch (ApiException e) {
                    return simple(st, "FAILED", inputs, sources, null, e.getMessage());
                }
            }
        }
        RunContext cc = new RunContext(child, inputs, ctx.connection, ctx);
        store.put(cc.runId, cc);
        cc.running.set(true);
        runSteps(cc, child.steps().stream().map(WorkflowStep::order).collect(Collectors.toCollection(TreeSet::new)));
        RunView childView = view(cc);
        List<StepRunView> kids = childView.steps();
        Map<String, Object> outputs = new LinkedHashMap<>();
        for (StepRunView k : kids) if (k.outputs() != null) outputs.putAll(k.outputs());
        ctx.firstRows.put(st.order(), new LinkedHashMap<>(outputs));
        List<Column> cols = List.of(new Column("step", "INTEGER"), new Column("name", "STRING"), new Column("status", "STRING"), new Column("duration_ms", "INTEGER"));
        List<List<Object>> rows = new ArrayList<>();
        for (StepRunView k : kids) rows.add(List.of(k.order(), k.name(), k.status(), k.durationMs() == null ? 0L : k.durationMs()));
        long ms = Duration.ofNanos(System.nanoTime() - t0).toMillis();
        QueryResult summary = new QueryResult(cols, rows, false, rows.size(), null, ms, "WORKFLOW");
        long ok = kids.stream().filter(k -> DONE.contains(k.status())).count();
        String message = "Ran '" + child.name() + "': " + ok + "/" + kids.size() + " step(s) completed (run " + cc.runId.substring(0, 8) + ")";
        if (!"SUCCESS".equals(cc.status)) {
            String why = kids.stream().filter(k -> k.error() != null).map(k -> "Step " + k.order() + " (" + k.name() + "): " + k.error()).findFirst().orElse("status " + cc.status);
            boolean userStop = "STOPPED".equals(cc.status);
            return new StepRunView(st.order(), st.name(), st.description(), label, userStop ? "STOPPED" : "FAILED", ms, 1, inputs, sources, summary,
                    outputs, null, message, userStop ? null : "'" + child.name() + "' did not complete (" + cc.status + "). " + why, kids);
        }
        return new StepRunView(st.order(), st.name(), st.description(), label, "SUCCESS", ms, 1, inputs, sources, summary, outputs, null, message, null, kids);
    }

    /** An API step: calls a saved API request (with optional wait / polling / assertions) and exposes its extracted values as outputs. */
    private StepRunView runApiStep(RunContext ctx, WorkflowStep st, long t0) {
        ApiRequestDef req = apiRequests.request(st.apiRequestId() == null ? -1 : st.apiRequestId()).orElse(null);
        if (req == null) return simple(st, "FAILED", Map.of(), Map.of(), null, "The API request for this step no longer exists");
        for (int dep : st.dependsOn()) {
            StepRunView dv = ctx.steps.get(dep);
            if (dv == null || !DONE.contains(dv.status())) {
                return blocked(st, Map.of(), Map.of(), "Upstream step " + dep + " has not completed successfully (" + (dv == null ? "not run yet" : dv.status()) + "). Run it first.");
            }
        }
        String label = "API: " + req.name();
        ApiStepRunner.Outcome o = apiSteps.run(req, st.apiOptions(), ctx.scope, RunControl.of(() -> stopped(ctx)), txt -> { });
        long ms = Duration.ofNanos(System.nanoTime() - t0).toMillis();
        Integer http = o.last() == null ? null : o.last().status();
        if (!o.success()) {
            return new StepRunView(st.order(), st.name(), st.description(), label, o.cancelled() ? "STOPPED" : "FAILED", ms, o.attempts(),
                    Map.of(), Map.of(), null, Map.of(), null, http == null ? null : "HTTP " + http, o.error());
        }
        List<Column> cols = new ArrayList<>();
        List<Object> row = new ArrayList<>();
        Map<String, Object> first = new LinkedHashMap<>();
        cols.add(new Column("http_status", "INTEGER"));
        row.add(http);
        first.put("http_status", http);
        List<String> saved = new ArrayList<>();
        for (ExtractedValue x : o.last().extracted()) {
            if (!x.found()) continue;
            cols.add(new Column(x.variable(), "STRING"));
            row.add(x.value());
            saved.add("{{" + x.variable() + "}}");
            if (!x.secret()) first.put(x.variable(), x.value()); // secrets stay in {{variables}} only
        }
        ctx.firstRows.put(st.order(), first);
        Map<String, Object> outputs = new LinkedHashMap<>(first);
        for (OutputField f : st.outputFields()) if (first.containsKey(f.column())) outputs.put(f.alias(), first.get(f.column()));
        QueryResult res = new QueryResult(cols, List.of(row), false, 1, null, ms, "API");
        String message = "HTTP " + http + (saved.isEmpty() ? "" : "; saved " + String.join(", ", saved)) + (o.attempts() > 1 ? "; satisfied on attempt " + o.attempts() : "");
        return new StepRunView(st.order(), st.name(), st.description(), label, "SUCCESS", ms, o.attempts(), Map.of(), Map.of(), res, outputs, null, message, null);
    }

    private record Resolved(String value, String source, String problem) {
    }

    private Resolved resolve(RunContext ctx, ParamMapping m) {
        switch (m.sourceType()) {
            case CONSTANT:
                return new Resolved(m.constantValue(), "Constant", null);
            case INPUT: {
                String v = ctx.inputs.get(m.sourceRef());
                String src = "Workflow input '" + m.sourceRef() + "'";
                return v == null || v.isBlank() ? new Resolved(null, src, "workflow input '" + m.sourceRef() + "' was not provided") : new Resolved(v, src, null);
            }
            default: {
                int up = parse(m.sourceRef());
                String src = "Step " + up + " -> " + m.sourceField();
                StepRunView uv = ctx.steps.get(up);
                if (uv == null) return new Resolved(null, src, "step " + up + " has not run");
                if ("NO_DATA".equals(uv.status())) return new Resolved(null, src, "step " + up + " returned no records");
                if (!DONE.contains(uv.status())) return new Resolved(null, src, "step " + up + " is " + uv.status());
                Object val = uv.outputs().get(m.sourceField());
                Map<String, Object> row = ctx.firstRows.getOrDefault(up, Map.of());
                if (val == null) val = row.get(m.sourceField());
                if (val == null) {
                    boolean exists = uv.outputs().containsKey(m.sourceField()) || row.containsKey(m.sourceField());
                    return new Resolved(null, src, exists ? "step " + up + " field '" + m.sourceField() + "' is empty (NULL)"
                            : "step " + up + " has no field '" + m.sourceField() + "' (available: " + String.join(", ", row.keySet())
                            + "). Fix the output mapping in Workflow Manager or enter the value manually");
                }
                return new Resolved(String.valueOf(val), src, null);
            }
        }
    }

    // ------------------------------------------------------------------ views and persistence

    private StepRunView simple(WorkflowStep st, String status, Map<String, String> params, Map<String, String> sources, String message, String error) {
        return new StepRunView(st.order(), st.name(), st.description(), st.queryName(), status, 0L, 0, params, sources, null, Map.of(), null, message, error);
    }

    private StepRunView blocked(WorkflowStep st, Map<String, String> params, Map<String, String> sources, String error) {
        return simple(st, "BLOCKED", params, sources, null, error);
    }

    private void put(RunContext ctx, WorkflowStep st, StepRunView v) {
        ctx.steps.put(st.order(), v);
        if (!"RUNNING".equals(v.status())) persistStep(ctx, v);
    }

    private RunView view(RunContext ctx) {
        List<StepRunView> list = new ArrayList<>();
        for (WorkflowStep st : ctx.workflow.steps()) {
            StepRunView v = ctx.steps.get(st.order());
            list.add(v != null ? v : simple(st, "PENDING", Map.of(), Map.of(), null, null));
        }
        Instant end = ctx.finished != null ? ctx.finished : Instant.now();
        return new RunView(ctx.runId, ctx.workflow.id(), ctx.workflow.name(), ctx.status, ctx.started, ctx.finished,
                Duration.between(ctx.started, end).toMillis(), ctx.inputs, list);
    }

    private String mask(String v) {
        return settings.get().maskSensitiveData() ? Masking.mask(v) : v;
    }

    private String maskedMap(Map<String, String> m) {
        return m.entrySet().stream().map(e -> e.getKey() + "=" + mask(e.getValue())).collect(Collectors.joining(", "));
    }

    private void persistStep(RunContext ctx, StepRunView v) {
        ensureRunRow(ctx);
        history.replaceStepRun(ctx.runId, v.order(), v.name(), v.status(), v.durationMs(), v.attempts(),
                v.result() == null ? null : v.result().rowCount(), v.rowsAffected(), maskedMap(v.params()),
                v.error() != null ? v.error() : ("BLOCKED".equals(v.status()) ? v.message() : null));
    }

    private void ensureRunRow(RunContext ctx) {
        persistRun(ctx);
    }

    private void persistRun(RunContext ctx) {
        Map<String, String> tracked = new HashMap<>();
        ctx.steps.values().forEach(v -> v.outputs().forEach((k, o) -> tracked.putIfAbsent(k, String.valueOf(o))));
        List<String> failed = ctx.steps.values().stream().filter(v -> "FAILED".equals(v.status()) || "BLOCKED".equals(v.status()))
                .map(v -> String.valueOf(v.order())).sorted().toList();
        long executed = ctx.steps.values().stream().filter(v -> DONE.contains(v.status())).count();
        String firstError = ctx.steps.values().stream().filter(v -> v.error() != null).map(v -> "Step " + v.order() + ": " + v.error())
                .findFirst().orElse(null);
        Instant end = ctx.finished != null ? ctx.finished : Instant.now();
        history.upsertRun(ctx.runId, ctx.workflow.id(), ctx.workflow.name(), ctx.status,
                mask(ctx.inputs.get("customerId")), mask(ctx.inputs.get("contributorId")),
                mask(tracked.get("clientUniqueId")), mask(tracked.get("paymentMasterId")), maskedMap(ctx.inputs),
                ctx.connection.name(), ctx.connection.environment(), ctx.started, ctx.finished,
                Duration.between(ctx.started, end).toMillis(), String.join(",", failed), 0,
                executed + " read-only step(s) completed; no data modified", firstError);
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s);
        } catch (Exception e) {
            return -1;
        }
    }
}
