package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.*;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.*;

/** Per-workflow reporting: pass rate, durations, per-step statistics, daily trend, recent runs and CSV export. */
@Service
public class ApiReportService {
    private final ApiWorkflowRepository repo;
    private final ApiWorkflowService workflows;

    public ApiReportService(ApiWorkflowRepository repo, ApiWorkflowService workflows) {
        this.repo = repo;
        this.workflows = workflows;
    }

    public WorkflowReport report(long workflowId, int days) {
        ApiWorkflowDef wf = workflows.get(workflowId);
        int d = Math.min(Math.max(days, 1), 365);
        Instant since = Instant.now().minus(d, ChronoUnit.DAYS);
        List<RunSummary> runs = repo.runs(workflowId, since, 5000).stream()
                .filter(r -> !r.status().equals("QUEUED") && !r.status().equals("RUNNING")).toList();
        int passed = count(runs, "SUCCESS");
        int failed = count(runs, "FAILED");
        int cancelled = count(runs, "CANCELLED");
        int timedOut = count(runs, "TIMED_OUT");
        List<Long> durations = runs.stream().filter(r -> r.durationMs() != null).map(RunSummary::durationMs).sorted().toList();
        double avg = durations.stream().mapToLong(Long::longValue).average().orElse(0);
        long p95 = durations.isEmpty() ? 0 : durations.get(Math.min(durations.size() - 1, (int) Math.ceil(durations.size() * 0.95) - 1));

        Map<Integer, List<Map<String, Object>>> byStep = new TreeMap<>();
        for (Map<String, Object> row : repo.stepRunRows(workflowId, since)) {
            Object ord = row.get("STEP_ORDER");
            if (ord == null) continue;
            byStep.computeIfAbsent(((Number) ord).intValue(), k -> new ArrayList<>()).add(row);
        }
        List<StepStat> stats = new ArrayList<>();
        for (ApiWfStep s : wf.steps()) {
            List<Map<String, Object>> rows = byStep.getOrDefault(s.order(), List.of()).stream()
                    .filter(r -> !"SKIPPED".equals(r.get("STEP_STATUS")) && !"CANCELLED".equals(r.get("STEP_STATUS"))).toList();
            int fails = (int) rows.stream().filter(r -> "FAILED".equals(r.get("STEP_STATUS"))).count();
            double avgMs = rows.stream().mapToLong(r -> num(r.get("DURATION_MS"))).average().orElse(0);
            long maxMs = rows.stream().mapToLong(r -> num(r.get("DURATION_MS"))).max().orElse(0);
            double avgAtt = rows.stream().mapToLong(r -> num(r.get("ATTEMPTS"))).average().orElse(0);
            stats.add(new StepStat(s.order(), s.name(), rows.size(), fails, avgMs, maxMs, avgAtt));
        }
        Map<String, int[]> trend = new TreeMap<>();
        for (RunSummary r : runs) {
            if (r.startedAt() == null) continue;
            String day = r.startedAt().atZone(ZoneId.systemDefault()).toLocalDate().toString();
            int[] c = trend.computeIfAbsent(day, k -> new int[3]);
            c[0]++;
            if (r.status().equals("SUCCESS")) c[1]++;
            else if (r.status().equals("FAILED") || r.status().equals("TIMED_OUT")) c[2]++;
        }
        List<DayStat> dayStats = trend.entrySet().stream().map(e -> new DayStat(e.getKey(), e.getValue()[0], e.getValue()[1], e.getValue()[2])).toList();
        RunSummary last = runs.isEmpty() ? null : runs.get(0);
        return new WorkflowReport(workflowId, wf.name(), d, runs.size(), passed, failed, cancelled, timedOut,
                runs.isEmpty() ? 0 : passed * 100.0 / runs.size(), avg, durations.isEmpty() ? 0 : durations.get(0),
                durations.isEmpty() ? 0 : durations.get(durations.size() - 1), p95, last == null ? null : last.status(),
                last == null ? null : last.startedAt(), stats, dayStats, runs.stream().limit(50).toList());
    }

    public List<OverviewRow> overview() {
        Instant since = Instant.now().minus(30, ChronoUnit.DAYS);
        List<OverviewRow> out = new ArrayList<>();
        for (ApiWorkflowDef wf : workflows.list()) {
            List<RunSummary> runs = repo.runs(wf.id(), since, 5000).stream()
                    .filter(r -> !r.status().equals("QUEUED") && !r.status().equals("RUNNING")).toList();
            int passed = count(runs, "SUCCESS");
            double avg = runs.stream().filter(r -> r.durationMs() != null).mapToLong(RunSummary::durationMs).average().orElse(0);
            RunSummary last = runs.isEmpty() ? null : runs.get(0);
            out.add(new OverviewRow(wf.id(), wf.name(), wf.steps().size(), runs.size(), runs.isEmpty() ? 0 : passed * 100.0 / runs.size(), avg,
                    last == null ? null : last.status(), last == null ? null : last.startedAt()));
        }
        return out;
    }

    /** One row per step execution, ready for Excel. */
    public String csv(long workflowId, int days) {
        workflows.get(workflowId);
        Instant since = Instant.now().minus(Math.min(Math.max(days, 1), 365), ChronoUnit.DAYS);
        StringBuilder sb = new StringBuilder("run_id,workflow,run_started,run_status,step_order,step_name,request,method,step_status,attempts,http_status,duration_ms,error\n");
        for (Map<String, Object> r : repo.stepRunRows(workflowId, since)) {
            sb.append(String.join(",", cell(r.get("RUN_ID")), cell(r.get("WORKFLOW_NAME")), cell(r.get("RUN_STARTED")), cell(r.get("RUN_STATUS")),
                    cell(r.get("STEP_ORDER")), cell(r.get("STEP_NAME")), cell(r.get("REQUEST_NAME")), cell(r.get("METHOD")), cell(r.get("STEP_STATUS")),
                    cell(r.get("ATTEMPTS")), cell(r.get("HTTP_STATUS")), cell(r.get("DURATION_MS")), cell(r.get("ERROR")))).append('\n');
        }
        return sb.toString();
    }

    private static String cell(Object o) {
        if (o == null) return "";
        String s = String.valueOf(o);
        if (!s.isEmpty() && "=+-@".indexOf(s.charAt(0)) >= 0) s = "'" + s; // neutralise spreadsheet formulas
        return "\"" + s.replace("\"", "\"\"").replace("\r", " ").replace("\n", " ") + "\"";
    }

    private static int count(List<RunSummary> runs, String status) {
        return (int) runs.stream().filter(r -> r.status().equals(status)).count();
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0;
    }
}
