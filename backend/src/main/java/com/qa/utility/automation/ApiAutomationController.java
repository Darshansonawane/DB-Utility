package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.folder.FolderDtos;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/automation")
public class ApiAutomationController {
    private final ApiAutomationService service;
    private final VariableService variables;
    private final ApiWorkflowService workflowService;
    private final ApiWorkflowRunner runner;
    private final ApiReportService reports;

    public ApiAutomationController(ApiAutomationService service, VariableService variables, ApiWorkflowService workflowService,
                                   ApiWorkflowRunner runner, ApiReportService reports) {
        this.service = service;
        this.variables = variables;
        this.workflowService = workflowService;
        this.runner = runner;
        this.reports = reports;
    }

    @GetMapping("/requests")
    public List<ApiRequestDef> requests() {
        return service.requests();
    }

    @PostMapping("/requests")
    public ApiRequestDef create(@Valid @RequestBody ApiRequestDef r) {
        return service.saveRequest(null, r);
    }

    @PutMapping("/requests/{id}")
    public ApiRequestDef update(@PathVariable long id, @Valid @RequestBody ApiRequestDef r) {
        return service.saveRequest(id, r);
    }

    @DeleteMapping("/requests/{id}")
    public void delete(@PathVariable long id) {
        service.deleteRequest(id);
    }

    /** Sends the request definition in the body (saved or not) and returns the response plus extracted variables. */
    @PostMapping("/run")
    public ApiRunResult run(@Valid @RequestBody ApiRequestDef r) {
        return service.run(r);
    }

    // ---- API workflows
    @GetMapping("/workflows")
    public List<ApiWorkflowDef> workflows() {
        return workflowService.list();
    }

    @PostMapping("/workflows")
    public ApiWorkflowDef createWorkflow(@Valid @RequestBody ApiWorkflowDef w) {
        return workflowService.save(null, w);
    }

    @PutMapping("/workflows/{id}")
    public ApiWorkflowDef updateWorkflow(@PathVariable long id, @Valid @RequestBody ApiWorkflowDef w) {
        return workflowService.save(id, w);
    }

    @DeleteMapping("/workflows/{id}")
    public void deleteWorkflow(@PathVariable long id) {
        workflowService.delete(id);
    }

    /** Starts a run and returns immediately with its id; poll GET /runs/{id} for progress. */
    @PostMapping("/workflows/{id}/run")
    public Map<String, String> run(@PathVariable long id, @RequestBody(required = false) RunWorkflowRequest r) {
        return Map.of("runId", runner.start(id, r == null ? null : r.inputs()));
    }

    @PostMapping("/workflows/run-batch")
    public Map<String, Object> runBatch(@RequestBody BatchRunRequest r) {
        return Map.of("runIds", runner.startBatch(r.workflowIds(), r.inputs()));
    }

    @GetMapping("/runs")
    public List<RunSummary> runs(@RequestParam(required = false) Long workflowId, @RequestParam(defaultValue = "50") int limit) {
        return runner.history(workflowId, limit);
    }

    @GetMapping("/runs/active")
    public Map<String, Object> activeRuns() {
        return Map.of("maxConcurrent", runner.maxConcurrent(), "runs", runner.activeRuns());
    }

    @GetMapping("/runs/{runId}")
    public ApiRunView runView(@PathVariable String runId) {
        return runner.get(runId);
    }

    @PostMapping("/runs/{runId}/cancel")
    public ApiRunView cancel(@PathVariable String runId) {
        return runner.cancel(runId);
    }

    // ---- reports
    @GetMapping("/reports/overview")
    public List<OverviewRow> overview() {
        return reports.overview();
    }

    @GetMapping("/workflows/{id}/report")
    public WorkflowReport report(@PathVariable long id, @RequestParam(defaultValue = "30") int days) {
        return reports.report(id, days);
    }

    @GetMapping(value = "/workflows/{id}/report.csv", produces = "text/csv")
    public org.springframework.http.ResponseEntity<String> reportCsv(@PathVariable long id, @RequestParam(defaultValue = "30") int days) {
        return org.springframework.http.ResponseEntity.ok()
                .header("Content-Disposition", "attachment; filename=\"api-workflow-" + id + "-report.csv\"")
                .body(reports.csv(id, days));
    }

    // ---- variables
    @GetMapping("/variables")
    public List<VariableView> variables() {
        return variables.list();
    }

    @PostMapping("/variables")
    public VariableView createVariable(@RequestBody VariableBody b) {
        return variables.save(null, b);
    }

    @PostMapping("/variables/bulk")
    public Map<String, Integer> bulkVariables(@RequestBody BulkVariables b) {
        String src = b.source() == null || b.source().isBlank() ? "manual" : b.source();
        int n = 0;
        for (BulkItem i : b.items()) {
            variables.put(i.name().trim(), i.value(), i.secret(), src, null, i.folderId());
            n++;
        }
        return Map.of("saved", n);
    }

    @PutMapping("/variables/{id:\\d+}")
    public VariableView updateVariable(@PathVariable long id, @RequestBody VariableBody b) {
        return variables.save(id, b);
    }

    @PutMapping("/variables/{id:\\d+}/folder")
    public void moveVariable(@PathVariable long id, @RequestBody FolderDtos.MoveItem b) {
        variables.move(id, b.folderId());
    }

    @DeleteMapping("/variables/{id:\\d+}")
    public void deleteVariable(@PathVariable long id) {
        variables.delete(id);
    }

    @DeleteMapping("/variables")
    public void clearVariables() {
        variables.clear();
    }

    @GetMapping("/environment")
    public Map<String, String> environment() {
        return Map.of("environment", variables.effectiveEnvironment());
    }

    @PutMapping("/environment")
    public Map<String, String> setEnvironment(@RequestBody Map<String, String> b) {
        variables.setActiveEnvironment(b.get("environment"));
        return Map.of("environment", variables.effectiveEnvironment());
    }

    // ---- moving items between folders
    @PutMapping("/requests/{id}/folder")
    public void moveRequest(@PathVariable long id, @RequestBody FolderDtos.MoveItem b) {
        service.moveRequest(id, b.folderId());
    }

    @PutMapping("/workflows/{id}/folder")
    public void moveWorkflow(@PathVariable long id, @RequestBody FolderDtos.MoveItem b) {
        workflowService.move(id, b.folderId());
    }

    // ---- preview + clearing history
    @PostMapping("/preview")
    public PreviewResult preview(@Valid @RequestBody ApiRequestDef r) {
        return service.preview(r);
    }

    @DeleteMapping("/runs")
    public Map<String, Integer> clearRuns(@RequestParam(required = false) Long workflowId) {
        return Map.of("deleted", runner.clearHistory(workflowId));
    }

    @PostMapping("/runs/delete")
    public Map<String, Integer> deleteRuns(@RequestBody RunIdsRequest r) {
        return Map.of("deleted", runner.deleteRuns(r.runIds()));
    }
}
