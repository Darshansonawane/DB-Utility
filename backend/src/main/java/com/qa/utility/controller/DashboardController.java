package com.qa.utility.controller;

import com.qa.utility.dto.ConnectionDtos.StatusView;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.repository.SavedQueryRepository;
import com.qa.utility.repository.WorkflowRepository;
import com.qa.utility.service.ConnectionService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {
    public record Dashboard(StatusView connection, long savedQueries, long workflows, long successfulExecutions,
                            long failedExecutions, List<Map<String, Object>> recentExecutions) {
    }

    private final ConnectionService connections;
    private final SavedQueryRepository queries;
    private final WorkflowRepository workflows;
    private final HistoryRepository history;

    public DashboardController(ConnectionService connections, SavedQueryRepository queries, WorkflowRepository workflows, HistoryRepository history) {
        this.connections = connections;
        this.queries = queries;
        this.workflows = workflows;
        this.history = history;
    }

    @GetMapping
    public Dashboard get() {
        Map<String, Long> c = history.executionCounts();
        return new Dashboard(connections.status(), queries.count(), workflows.count(), c.get("successful"), c.get("failed"), history.executions(8, null));
    }
}
