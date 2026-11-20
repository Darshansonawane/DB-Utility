package com.qa.utility.automation;

import com.qa.utility.audit.AuditService;
import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.exception.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class ApiWorkflowService {
    private final ApiWorkflowRepository repo;
    private final ApiAutomationRepository requests;
    private final AuditService audit;
    private final com.qa.utility.folder.FolderService folders;
    private final com.qa.utility.repository.SavedQueryRepository queries;

    public ApiWorkflowService(ApiWorkflowRepository repo, ApiAutomationRepository requests, AuditService audit,
                              com.qa.utility.folder.FolderService folders, com.qa.utility.repository.SavedQueryRepository queries) {
        this.repo = repo;
        this.requests = requests;
        this.audit = audit;
        this.folders = folders;
        this.queries = queries;
    }

    public void move(long id, Long folderId) {
        get(id);
        repo.move(id, folders.requireFolder("API_WORKFLOW", folderId));
    }

    public List<ApiWorkflowDef> list() {
        return repo.findAll();
    }

    public ApiWorkflowDef get(long id) {
        return repo.find(id).orElseThrow(() -> ApiException.notFound("API workflow not found"));
    }

    public ApiWorkflowDef save(Long id, ApiWorkflowDef w) {
        ApiWorkflowDef n = validate(w);
        try {
            long wid;
            if (id == null) {
                wid = repo.insert(n);
            } else {
                get(id);
                repo.update(id, n);
                wid = id;
            }
            audit.record(id == null ? "API_WORKFLOW_CREATED" : "API_WORKFLOW_UPDATED", null, null, null, null, "SUCCESS", n.name());
            return get(wid);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("An API workflow named '" + n.name() + "' already exists");
        }
    }

    public void delete(long id) {
        ApiWorkflowDef w = get(id);
        repo.delete(id);
        audit.record("API_WORKFLOW_DELETED", null, null, null, null, "SUCCESS", w.name());
    }

    private ApiWorkflowDef validate(ApiWorkflowDef w) {
        if (w.steps().isEmpty()) throw ApiException.badRequest("Add at least one API step");
        if (w.maxRunSeconds() > 86_400) throw ApiException.badRequest("Maximum run time must be at most 86400 seconds");
        Set<Integer> orders = new HashSet<>();
        java.util.ArrayList<ApiWfStep> steps = new java.util.ArrayList<>();
        for (ApiWfStep s : w.steps()) {
            if (!orders.add(s.order())) throw ApiException.badRequest("Duplicate step order " + s.order());
            if (s.isSql()) {
                var q = queries.findById(s.queryId() == null ? -1 : s.queryId()).orElseThrow(() -> ApiException.badRequest("Step " + s.order() + ": SQL query not found"));
                if (q.queryType() == com.qa.utility.model.QueryType.WRITE) throw ApiException.badRequest("Step " + s.order() + ": workflows only run read-only (SELECT) queries");
            } else {
                requests.request(s.requestId()).orElseThrow(() -> ApiException.badRequest("Step " + s.order() + ": API request not found"));
            }
            if (!s.onFailure().equals("STOP") && !s.onFailure().equals("CONTINUE")) throw ApiException.badRequest("Step " + s.order() + ": on-failure must be STOP or CONTINUE");
            steps.add(new ApiWfStep(s.id(), s.order(), s.name().trim(), s.requestId(), s.requestName(), s.requestMethod(), s.onFailure(), s.enabled(), s.options().normalised(),
                    s.stepType(), s.queryId(), s.queryName(), s.paramValues()));
        }
        steps.sort(java.util.Comparator.comparingInt(ApiWfStep::order));
        return new ApiWorkflowDef(w.id(), w.name().trim(), w.description(), w.publishGlobal(), w.maxRunSeconds(), steps, folders.requireFolder("API_WORKFLOW", w.folderId()));
    }
}
