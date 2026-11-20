package com.qa.utility.workflow;

import com.qa.utility.audit.AuditService;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.QueryParameter;
import com.qa.utility.model.SavedQuery;
import com.qa.utility.model.Workflow;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.SavedQueryRepository;
import com.qa.utility.repository.WorkflowRepository;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class WorkflowService {
    private final WorkflowRepository repo;
    private final SavedQueryRepository queries;
    private final AuditService audit;
    private final com.qa.utility.automation.ApiAutomationRepository apiRequests;
    private final com.qa.utility.folder.FolderService folders;

    public WorkflowService(WorkflowRepository repo, SavedQueryRepository queries, AuditService audit,
                           com.qa.utility.automation.ApiAutomationRepository apiRequests, com.qa.utility.folder.FolderService folders) {
        this.apiRequests = apiRequests;
        this.folders = folders;
        this.repo = repo;
        this.queries = queries;
        this.audit = audit;
    }

    public List<Workflow> list() {
        return repo.findAll();
    }

    public Workflow get(long id) {
        return repo.findById(id).orElseThrow(() -> ApiException.notFound("Workflow not found"));
    }

    public Workflow create(Workflow w) {
        w = normalised(w);
        validate(w, null);
        try {
            long id = repo.insert(w);
            audit.record("WORKFLOW_CREATED", null, null, null, null, "SUCCESS", w.name());
            return get(id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A workflow named '" + w.name() + "' already exists");
        }
    }

    public Workflow update(long id, Workflow w) {
        get(id);
        w = normalised(w);
        validate(w, id);
        try {
            repo.update(id, w);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A workflow named '" + w.name() + "' already exists");
        }
        audit.record("WORKFLOW_UPDATED", null, null, null, null, "SUCCESS", w.name());
        return get(id);
    }

    public void move(long id, Long folderId) {
        get(id);
        repo.move(id, folders.requireFolder("WORKFLOW", folderId));
    }

    public void delete(long id) {
        Workflow w = get(id);
        List<String> parents = repo.usedBy(id);
        if (!parents.isEmpty()) {
            throw ApiException.conflict("'" + w.name() + "' is used as a step in: " + String.join(", ", parents) + ". Remove it from those workflows first.");
        }
        repo.delete(id);
        audit.record("WORKFLOW_DELETED", null, null, null, null, "SUCCESS", w.name());
    }

    private Workflow normalised(Workflow w) {
        return new Workflow(w.id(), w.name(), w.description(), w.inputs(), w.steps(), folders.requireFolder("WORKFLOW", w.folderId()));
    }

    private static final int MAX_NESTING = 5;

    /** Deepest chain of nested workflows below {@code id}; throws when it reaches {@code self} (a cycle). */
    private int nesting(long id, Long self, Set<Long> path) {
        if (self != null && id == self) throw ApiException.badRequest("A workflow cannot contain itself, directly or through other workflows");
        if (!path.add(id)) throw ApiException.badRequest("Workflows contain each other in a loop");
        int deepest = 0;
        Workflow w = repo.findById(id).orElse(null);
        if (w != null) {
            for (WorkflowStep st : w.steps()) {
                if (st.isWorkflow() && st.subWorkflowId() != null) deepest = Math.max(deepest, 1 + nesting(st.subWorkflowId(), self, path));
            }
        }
        path.remove(id);
        return deepest;
    }

    /** Steps must reference real queries and parameters; dependencies and step-output mappings must point backwards (no cycles). */
    void validate(Workflow w, Long selfId) {
        Set<String> inputNames = new HashSet<>();
        for (WorkflowInput in : w.inputs()) if (!inputNames.add(in.name())) throw ApiException.badRequest("Duplicate workflow input '" + in.name() + "'");
        Set<Integer> orders = new HashSet<>();
        Map<Integer, WorkflowStep> byOrder = new HashMap<>();
        for (WorkflowStep s : w.steps()) {
            if (!orders.add(s.order())) throw ApiException.badRequest("Duplicate step order " + s.order());
            byOrder.put(s.order(), s);
        }
        for (WorkflowStep s : w.steps()) {
            for (int d : s.dependsOn()) {
                if (!orders.contains(d) || d >= s.order()) throw ApiException.badRequest("Step " + s.order() + ": dependency " + d + " must be an earlier step");
            }
            if (s.isApi()) {
                if (s.apiRequestId() == null || apiRequests.request(s.apiRequestId()).isEmpty()) {
                    throw ApiException.badRequest("Step " + s.order() + ": API request not found");
                }
                if (s.apiOptions() != null) s.apiOptions().normalised();
                continue;
            }
            if (s.isWorkflow()) {
                Long subId = s.subWorkflowId();
                if (subId == null) throw ApiException.badRequest("Step " + s.order() + ": choose the workflow to run");
                Workflow sub = repo.findById(subId).orElseThrow(() -> ApiException.badRequest("Step " + s.order() + ": workflow not found"));
                int depth = 1 + nesting(subId, selfId, new HashSet<>());
                if (depth > MAX_NESTING) throw ApiException.badRequest("Step " + s.order() + ": workflows can be nested at most " + MAX_NESTING + " levels deep");
                Set<String> childInputs = new HashSet<>();
                for (WorkflowInput in : sub.inputs()) childInputs.add(in.name());
                validateMappings(s, childInputs, "workflow '" + sub.name() + "' has no input", inputNames, orders);
                continue;
            }
            SavedQuery q = queries.findById(s.queryId()).orElseThrow(() -> ApiException.badRequest("Step " + s.order() + ": query not found"));
            Set<String> params = new HashSet<>();
            for (QueryParameter p : q.parameters()) params.add(p.name());
            for (int d : s.dependsOn()) {
                if (!orders.contains(d) || d >= s.order()) throw ApiException.badRequest("Step " + s.order() + ": dependency " + d + " must be an earlier step");
            }
            validateMappings(s, params, "query has no parameter", inputNames, orders);
            if (s.retryCount() < 0 || s.retryCount() > 5) throw ApiException.badRequest("Step " + s.order() + ": retry count must be 0..5");
        }
    }

    private void validateMappings(WorkflowStep s, Set<String> allowed, String unknownMsg, Set<String> inputNames, Set<Integer> orders) {
        for (ParamMapping m : s.mappings()) {
            if (!allowed.contains(m.paramName())) throw ApiException.badRequest("Step " + s.order() + ": " + unknownMsg + " '" + m.paramName() + "'");
            switch (m.sourceType()) {
                case INPUT -> {
                    if (!inputNames.contains(m.sourceRef())) throw ApiException.badRequest("Step " + s.order() + ": unknown workflow input '" + m.sourceRef() + "'");
                }
                case STEP_OUTPUT -> {
                    int ref;
                    try {
                        ref = Integer.parseInt(m.sourceRef());
                    } catch (Exception e) {
                        throw ApiException.badRequest("Step " + s.order() + ": invalid upstream step reference '" + m.sourceRef() + "'");
                    }
                    if (!orders.contains(ref) || ref >= s.order()) throw ApiException.badRequest("Step " + s.order() + ": mapped upstream step must be an earlier step");
                    if (m.sourceField() == null || m.sourceField().isBlank()) throw ApiException.badRequest("Step " + s.order() + ": mapping needs an upstream output field");
                }
                case CONSTANT -> {
                    if (m.constantValue() == null) throw ApiException.badRequest("Step " + s.order() + ": constant mapping needs a value");
                }
            }
        }
    }
}
