package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.ApiRunResult;
import com.qa.utility.automation.ApiDtos.ApiStepOptions;
import com.qa.utility.automation.ApiDtos.ExtractedValue;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.QueryType;
import com.qa.utility.model.SavedQuery;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.service.SqlExecutionService;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import com.qa.utility.service.TargetDataSourceProvider;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Runs a saved read-only SQL query as a workflow step: parameters come from {{variables}} (parameterised binding, never string
 * concatenation), the query is retried until a row exists when more than one attempt is allowed, and the query's extractions are
 * saved as variables. Wait / poll interval / timeout / attempts come from the step options.
 */
@Service
public class SqlStepRunner {
    private final QueryLibraryService library;
    private final SqlExecutionService sql;
    private final TargetDataSourceProvider provider;

    public SqlStepRunner(QueryLibraryService library, SqlExecutionService sql, TargetDataSourceProvider provider) {
        this.library = library;
        this.sql = sql;
        this.provider = provider;
    }

    public ApiStepRunner.Outcome run(SavedQuery q, Map<String, String> paramValues, ApiStepOptions raw, String workflowName, String stepName,
                                     VarScope scope, RunControl control, Consumer<String> live) {
        ApiStepOptions opt = (raw == null ? ApiStepOptions.defaults() : raw).normalised();
        int maxAttempts = opt.maxAttempts();
        String label = "DB " + (q.databaseName() != null ? q.databaseName() : provider.activeProfile().map(p -> p.databaseName()).orElse("?"));
        if (q.queryType() == QueryType.WRITE) return fail(label, 0, maxAttempts, "Workflows only run read-only (SELECT) queries", 0);
        if (opt.waitBeforeSeconds() > 0) {
            live.accept("Waiting " + opt.waitBeforeSeconds() + "s before the query");
            if (!control.sleep(opt.waitBeforeSeconds() * 1000L)) return stopped(control, label, 0, maxAttempts);
        }
        long deadline = System.currentTimeMillis() + opt.pollTimeoutSeconds() * 1000L;
        int attempt = 0;
        String reason;
        while (true) {
            if (control.shouldStop()) return stopped(control, label, attempt, maxAttempts);
            attempt++;
            long t0 = System.nanoTime();
            live.accept(maxAttempts > 1 ? "Query attempt " + attempt + " of " + maxAttempts : "Running query");
            List<BoundParam> bound;
            try {
                library.checkRunnable(q);
                bound = library.bind(q, paramValues, scope);
            } catch (ApiException e) {
                return fail(label, attempt, maxAttempts, e.getMessage(), ms(t0)); // missing variable / bad value: retrying cannot help
            }
            QueryResult res = null;
            try {
                res = sql.execute(q.sql(), bound, null, ExecContext.workflow(q.id(), workflowName + " / " + stepName, q.databaseName()));
                reason = null;
            } catch (ApiException e) {
                if (e.getMessage() != null && e.getMessage().startsWith("Not connected")) return fail(label, attempt, maxAttempts, e.getMessage(), ms(t0));
                reason = e.getMessage();
            }
            if (res != null) {
                boolean needsRow = !q.extractions().isEmpty() || maxAttempts > 1;
                if (res.rowCount() > 0 || !needsRow) {
                    QueryLibraryService.ExtractionOutcome ex = library.applyExtractions(q, res, scope);
                    if (!ex.problems().isEmpty()) return failWith(label, attempt, maxAttempts, String.join("; ", ex.problems()), ms(t0), ex.values());
                    return new ApiStepRunner.Outcome(true, false, false, attempt, maxAttempts,
                            new ApiRunResult(q.name(), true, null, ms(t0), label, Map.of(), null, false, ex.values(), null, List.of(), null), null);
                }
                reason = "no rows returned yet";
            }
            boolean attemptsLeft = attempt < maxAttempts;
            long waitMs = opt.pollIntervalSeconds() * 1000L;
            if (!attemptsLeft || System.currentTimeMillis() + waitMs > deadline) {
                String why = !attemptsLeft ? "gave up after " + attempt + " attempt(s)" : "poll timeout of " + opt.pollTimeoutSeconds() + "s reached after " + attempt + " attempt(s)";
                return fail(label, attempt, maxAttempts, (maxAttempts > 1 ? "Not satisfied: " + why + ". Last: " : "") + reason, ms(t0));
            }
            live.accept("Attempt " + attempt + "/" + maxAttempts + ": " + reason + "; retrying in " + opt.pollIntervalSeconds() + "s");
            if (!control.sleep(waitMs)) return stopped(control, label, attempt, maxAttempts);
        }
    }

    private static long ms(long t0) {
        return (System.nanoTime() - t0) / 1_000_000;
    }

    private static ApiStepRunner.Outcome fail(String label, int attempts, int max, String error, long ms) {
        return failWith(label, attempts, max, error, ms, List.of());
    }

    private static ApiStepRunner.Outcome failWith(String label, int attempts, int max, String error, long ms, List<ExtractedValue> extracted) {
        return new ApiStepRunner.Outcome(false, false, false, attempts, max,
                new ApiRunResult(label, false, null, ms, label, Map.of(), null, false, extracted, error, List.of(), null), error);
    }

    private static ApiStepRunner.Outcome stopped(RunControl control, String label, int attempts, int max) {
        boolean t = control.timedOut();
        String msg = t ? "Workflow time limit reached" : "Stopped";
        return new ApiStepRunner.Outcome(false, !t, t, attempts, max,
                new ApiRunResult(label, false, null, 0, label, Map.of(), null, false, List.of(), msg, List.of(), null), msg);
    }
}
