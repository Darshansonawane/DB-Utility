package com.qa.utility.controller;

import com.qa.utility.audit.AuditService;
import com.qa.utility.exception.ApiException;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.security.Masking;
import com.qa.utility.service.SettingsService;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/history")
public class HistoryController {
    private final HistoryRepository history;
    private final AuditService audit;
    private final SettingsService settings;

    public HistoryController(HistoryRepository history, AuditService audit, SettingsService settings) {
        this.history = history;
        this.audit = audit;
        this.settings = settings;
    }

    @GetMapping("/executions")
    public List<Map<String, Object>> executions(@RequestParam(defaultValue = "100") int limit, @RequestParam(required = false) String status) {
        return history.executions(limit, status);
    }

    @GetMapping("/workflow-runs")
    public List<Map<String, Object>> runs(@RequestParam(defaultValue = "100") int limit, @RequestParam(required = false) String customerId) {
        String key = customerId == null || customerId.isBlank() ? null : (settings.get().maskSensitiveData() ? Masking.mask(customerId.trim()) : customerId.trim());
        return history.runs(limit, key);
    }

    @GetMapping("/workflow-runs/{id}")
    public Map<String, Object> run(@PathVariable String id) {
        List<Map<String, Object>> r = history.runById(id);
        if (r.isEmpty()) throw ApiException.notFound("Workflow run not found");
        Map<String, Object> out = new LinkedHashMap<>(r.get(0));
        out.put("steps", history.stepRuns(id));
        return out;
    }

    @GetMapping("/audit")
    public List<Map<String, Object>> audit(@RequestParam(defaultValue = "100") int limit) {
        return audit.recent(limit);
    }
}
