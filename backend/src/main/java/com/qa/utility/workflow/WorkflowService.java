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
    private final com.qa.utility.project.ProjectService projects;

    public WorkflowService(WorkflowRepository repo, SavedQueryRepository queries, AuditService audit,
                           com.qa.utility.automation.ApiAutomationRepository apiRequests, com.qa.utility.folder.FolderService folders,
                           com.qa.utility.project.ProjectService projects) {
        this.projects = projects;
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
        w = normalised(w, null);
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
        Workflow existing = get(id);
        w = normalised(w, existing);
        validate(w, id);
        try {
            repo.update(id, w);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A workflow named '" + w.name() + "' already exists");
        }
        audit.record("WORKFLOW_UPDATED", null, null, null, null, "SUCCESS", w.name());
        return get(id);
    }

    /** Moves within the workflow's project (folderId 0 = directly in the project), or to another project when {@code projectId} is given. */
    public void move(long id, Long folderId, Long projectId) {
        Workflow w = get(id);
        long project = projectId == null || projectId == 0 ? w.projectId() : projects.requireProject(projectId);
        long folder = folders.requireWorkflowFolder(folderId, project);
        if (project != w.projectId()) {
            if (repo.nameTaken(project, w.name(), id)) throw ApiException.conflict("The target project already has a workflow named '" + w.name() + "'");
            repo.move(id, project, folder);
        } else {
            repo.move(id, folder);
        }
        projects.touch(project);
        audit.record("WORKFLOW_MOVED", null, null, null, null, "SUCCESS", w.name());
    }

    public void move(long id, Long folderId) {
        move(id, folderId, null);
    }

    public void delete(long id) {
        Workflow w = get(id);
        List<String> parents = repo.usedBy(id);
        if (!parents.isEmpty()) {
            throw ApiException.conflict("'" + w.name() + "' is used as a step in: " + String.join(", ", parents) + ". Remove it from those workflows first.");
        }
        repo.delete(id);
        projects.touch(w.projectId());
        audit.record("WORKFLOW_DELETED", null, null, null, null, "SUCCESS", w.name());
    }

    /** Every workflow belongs to a project: the one given, else its folder's project, else (on update) the current one, else the default project. */
    /** What the Run dialog shows: inputs with defaults, and each step's parameters with where their value comes from. */
    public com.qa.utility.dto.WorkflowDtos.RunForm runForm(long id) {
        Workflow w = get(id);
        List<com.qa.utility.dto.WorkflowDtos.RunInput> inputs = w.inputs().stream()
                .map(i -> new com.qa.utility.dto.WorkflowDtos.RunInput(i.name(), i.label(), i.type().name(), i.required(), i.defaultValue())).toList();
        List<com.qa.utility.dto.WorkflowDtos.RunStep> steps = new ArrayList<>();
        for (WorkflowStep st : w.steps()) {
            List<com.qa.utility.dto.WorkflowDtos.RunParam> params = new ArrayList<>();
            if (st.isWorkflow() && st.subWorkflowId() != null) {
                Workflow child = repo.findById(st.subWorkflowId()).orElse(null);
                if (child != null) for (WorkflowInput ci : child.inputs()) params.add(runParam(st, ci.name(), ci.label(), ci.type().name(), ci.required(), ci.defaultValue()));
            } else if (!st.isApi()) {
                SavedQuery q = queries.findById(st.queryId()).orElse(null);
                if (q != null) for (QueryParameter p : q.parameters()) params.add(runParam(st, p.name(), p.label(), p.type().name(), p.required(), p.defaultValue()));
            }
            steps.add(new com.qa.utility.dto.WorkflowDtos.RunStep(st.order(), st.name(), st.stepType(), params));
        }
        return new com.qa.utility.dto.WorkflowDtos.RunForm(inputs, steps);
    }

    private static com.qa.utility.dto.WorkflowDtos.RunParam runParam(WorkflowStep st, String name, String label, String type, boolean required, String def) {
        ParamMapping m = st.mappings().stream().filter(x -> x.paramName().equals(name)).findFirst().orElse(null);
        boolean hasDefault = def != null && !def.isBlank();
        String kind;
        String source;
        if (m == null) {
            kind = hasDefault ? "DEFAULT" : "NONE";
            source = hasDefault ? "Default value" : "Not provided";
        } else if (m.sourceType() == SourceType.STEP_OUTPUT) {
            kind = "AUTOMATIC";
            source = "Step " + m.sourceRef() + " -> " + m.sourceField();
        } else if (m.sourceType() == SourceType.INPUT) {
            kind = "WORKFLOW_INPUT";
            source = "Workflow input '" + m.sourceRef() + "'";
        } else {
            kind = "CONSTANT";
            source = "Constant";
        }
        return new com.qa.utility.dto.WorkflowDtos.RunParam(name, label, type, required, hasDefault ? def : null, kind, source,
                m != null && m.sourceType() == SourceType.CONSTANT ? m.constantValue() : null, m != null && m.sourceType() == SourceType.INPUT ? m.sourceRef() : null);
    }

    /** Explicitly saves default values for workflow inputs. Run-time values never change a workflow unless they are saved here. */
    public void saveInputDefaults(long id, Map<String, String> defaults) {
        Workflow w = get(id);
        if (defaults == null) return;
        for (Map.Entry<String, String> e : defaults.entrySet()) {
            WorkflowInput in = w.inputs().stream().filter(i -> i.name().equals(e.getKey())).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("Unknown workflow input '" + e.getKey() + "'"));
            if (e.getValue() != null && !e.getValue().isBlank()) in.type().convert(e.getValue(), in.label());
            repo.setInputDefault(id, in.name(), e.getValue());
        }
        audit.record("WORKFLOW_DEFAULTS_SAVED", null, null, null, null, "SUCCESS", w.name());
    }

    private Workflow normalised(Workflow w, Workflow existing) {
        Long requested = w.projectId() == null || w.projectId() == 0 ? null : w.projectId();
        long project;
        if (requested != null) project = projects.requireProject(requested);
        else if (w.folderId() != null && w.folderId() != 0) project = folders.get(w.folderId()).projectId();
        else if (existing != null) project = existing.projectId();
        else project = projects.requireProject(null);
        long folder = folders.requireWorkflowFolder(w.folderId(), project);
        return new Workflow(w.id(), w.name(), w.description(), w.inputs(), w.steps(), folder, project);
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
        for (WorkflowInput in : w.inputs()) {
            if (!inputNames.add(in.name())) throw ApiException.badRequest("Duplicate workflow input '" + in.name() + "'");
            if (in.hasDefault()) in.type().convert(in.defaultValue(), in.label()); // a default must be a valid value of the input's type
        }
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
