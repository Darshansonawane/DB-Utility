package com.qa.utility.controller;

import com.qa.utility.dto.WorkflowDtos.*;
import com.qa.utility.model.Workflow;
import com.qa.utility.workflow.WorkflowExecutor;
import com.qa.utility.workflow.WorkflowService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class WorkflowController {
    private final WorkflowService service;
    private final WorkflowExecutor executor;

    public WorkflowController(WorkflowService service, WorkflowExecutor executor) {
        this.service = service;
        this.executor = executor;
    }

    @GetMapping("/workflows")
    public List<Workflow> list() {
        return service.list();
    }

    @GetMapping("/workflows/{id}")
    public Workflow get(@PathVariable long id) {
        return service.get(id);
    }

    @PostMapping("/workflows")
    public Workflow create(@Valid @RequestBody Workflow w) {
        return service.create(w);
    }

    @PutMapping("/workflows/{id}")
    public Workflow update(@PathVariable long id, @Valid @RequestBody Workflow w) {
        return service.update(id, w);
    }

    @PutMapping("/workflows/{id}/folder")
    public void move(@PathVariable long id, @RequestBody com.qa.utility.folder.FolderDtos.MoveItem b) {
        service.move(id, b.folderId());
    }

    @DeleteMapping("/workflows/{id}")
    public void delete(@PathVariable long id) {
        service.delete(id);
    }

    @PostMapping("/workflows/{id}/runs")
    public RunView start(@PathVariable long id, @RequestBody StartRunRequest r) {
        return executor.start(id, r.inputs(), r.overrides(), r.steps());
    }

    @GetMapping("/workflow-runs/{runId}")
    public RunView run(@PathVariable String runId) {
        return executor.get(runId);
    }

    @PostMapping("/workflow-runs/{runId}/execute")
    public RunView execute(@PathVariable String runId, @RequestBody ExecuteRequest r) {
        return executor.execute(runId, r.steps(), r.overrides());
    }

    @PostMapping("/workflow-runs/{runId}/stop")
    public RunView stop(@PathVariable String runId) {
        return executor.stop(runId);
    }
}
