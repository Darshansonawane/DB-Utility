package com.qa.utility.automation;

import com.fasterxml.jackson.databind.JsonNode;
import com.qa.utility.automation.ApiDtos.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/**
 * Runs one API step with the standard behaviours shared by API workflows and DB workflows:
 * wait before, poll/retry until the response is acceptable (bounded by attempts and a timeout), then assertions.
 */
@Service
public class ApiStepRunner {
    public record Outcome(boolean success, boolean cancelled, boolean timedOut, int attempts, int maxAttempts,
                          ApiRunResult last, String error) {
    }

    private final ApiExecutor executor;
    private final ConditionEvaluator conditions;

    public ApiStepRunner(ApiExecutor executor, ConditionEvaluator conditions) {
        this.executor = executor;
        this.conditions = conditions;
    }

    public Outcome run(ApiRequestDef def, ApiStepOptions raw, VarScope scope, RunControl control, Consumer<String> live) {
        ApiStepOptions opt = (raw == null ? ApiStepOptions.defaults() : raw).normalised();
        int maxAttempts = opt.maxAttempts();
        if (opt.waitBeforeSeconds() > 0) {
            live.accept("Waiting " + opt.waitBeforeSeconds() + "s before the request");
            if (!control.sleep(opt.waitBeforeSeconds() * 1000L)) return stopped(control, 0, maxAttempts, null);
        }
        long deadline = System.currentTimeMillis() + opt.pollTimeoutSeconds() * 1000L;
        ApiRunResult last = null;
        String reason = null;
        int attempt = 0;
        while (true) {
            if (control.shouldStop()) return stopped(control, attempt, maxAttempts, last);
            attempt++;
            live.accept(maxAttempts > 1 ? "Attempt " + attempt + " of " + maxAttempts : "Sending request");
            ApiExecutor.Exchange x = executor.exchange(def, scope);
            List<String> problems = new ArrayList<>();
            if (x.failed()) {
                problems.add(x.error());
            } else {
                problems.addAll(executor.statusProblems(def, x));
                JsonNode tree = needsJson(opt) ? executor.parseJson(x.body()) : null;
                for (Condition c : opt.until()) conditions.check(c, x, tree, scope).ifPresent(problems::add);
            }
            if (problems.isEmpty()) {
                // accepted: store extractions, then run assertions once
                List<String> exProblems = new ArrayList<>();
                List<ExtractedValue> extracted = executor.extract(def, x, scope, exProblems);
                if (exProblems.isEmpty()) {
                    List<String> failed = new ArrayList<>();
                    JsonNode tree = executor.parseJson(x.body());
                    for (Condition c : opt.assertions()) {
                        Optional<String> r = conditions.check(c, x, tree, scope);
                        r.ifPresent(m -> failed.add("Assertion failed: " + m));
                    }
                    last = executor.toResult(def, x, extracted, failed.isEmpty() ? null : String.join("; ", failed));
                    return failed.isEmpty() ? new Outcome(true, false, false, attempt, maxAttempts, last, null)
                            : new Outcome(false, false, false, attempt, maxAttempts, last, last.error());
                }
                problems.addAll(exProblems);
                last = executor.toResult(def, x, extracted, String.join("; ", problems));
            } else {
                last = executor.toResult(def, x, List.of(), String.join("; ", problems));
            }
            reason = String.join("; ", problems);
            if (x.fatal()) return new Outcome(false, false, false, attempt, maxAttempts, last, reason);
            boolean attemptsLeft = attempt < maxAttempts;
            long waitMs = opt.pollIntervalSeconds() * 1000L;
            boolean timeLeft = System.currentTimeMillis() + waitMs <= deadline;
            if (!attemptsLeft || !timeLeft) {
                String why = !attemptsLeft ? "gave up after " + attempt + " attempt(s)" : "poll timeout of " + opt.pollTimeoutSeconds() + "s reached after " + attempt + " attempt(s)";
                return new Outcome(false, false, false, attempt, maxAttempts, last, (maxAttempts > 1 ? "Not satisfied: " + why + ". Last: " : "") + reason);
            }
            live.accept("Attempt " + attempt + "/" + maxAttempts + " not satisfied (" + shorten(reason) + "); retrying in " + opt.pollIntervalSeconds() + "s");
            if (!control.sleep(waitMs)) return stopped(control, attempt, maxAttempts, last);
        }
    }

    private static boolean needsJson(ApiStepOptions o) {
        return o.until().stream().anyMatch(c -> c.source().equalsIgnoreCase("BODY"));
    }

    private static Outcome stopped(RunControl control, int attempts, int max, ApiRunResult last) {
        boolean t = control.timedOut();
        return new Outcome(false, !t, t, attempts, max, last, t ? "Workflow time limit reached" : "Stopped");
    }

    private static String shorten(String s) {
        return s.length() > 120 ? s.substring(0, 120) + "…" : s;
    }
}
