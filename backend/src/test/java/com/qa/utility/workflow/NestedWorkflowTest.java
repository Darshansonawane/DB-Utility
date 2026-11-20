package com.qa.utility.workflow;

import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderService;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class NestedWorkflowTest extends AbstractDbTest {
    @Autowired WorkflowService workflows;
    @Autowired WorkflowExecutor executor;
    @Autowired QueryLibraryService library;
    @Autowired FolderService folders;

    private SavedQuery query(String sql, QueryParameter p, QueryExtraction... ex) {
        return library.create(new SavedQuery(null, "nq" + UUID.randomUUID(), "", "Test", sql, QueryType.READ, List.of(), true, null,
                p == null ? List.of() : List.of(p), List.of(ex)));
    }

    private static QueryParameter param(String name) {
        return new QueryParameter(name, name, ParamType.STRING, true, null);
    }

    private WorkflowStep queryStep(int order, SavedQuery q, boolean stop, List<OutputField> out, List<ParamMapping> maps) {
        return new WorkflowStep(null, order, "s" + order, null, q.id(), q.name(), List.of(), 0, 0, stop, out, maps);
    }

    private static ParamMapping input(String param, String ref) {
        return new ParamMapping(param, SourceType.INPUT, ref, null, null);
    }

    private WorkflowStep workflowStep(int order, Workflow sub, boolean stop, ParamMapping... maps) {
        return new WorkflowStep(null, order, "w" + order, null, 0, null, List.of(), 0, 0, stop, List.of(), List.of(maps),
                "WORKFLOW", null, null, null, sub.id(), sub.name());
    }

    private Workflow create(String prefix, List<WorkflowInput> inputs, WorkflowStep... steps) {
        return workflows.create(new Workflow(null, prefix + UUID.randomUUID().toString().substring(0, 6), "", inputs, List.of(steps)));
    }

    private static StepRunView step(RunView r, int order) {
        return r.steps().stream().filter(s -> s.order() == order).findFirst().orElseThrow();
    }

    @Test
    void microWorkflowsComposeIntoABigOneAndPassValuesAlong() {
        SavedQuery findTx = query("SELECT * FROM employee_transaction WHERE hr_id = ? ORDER BY id", param("hr_id"));
        Workflow microA = create("microA", List.of(new WorkflowInput("hr", "HR", ParamType.STRING, true)),
                queryStep(1, findTx, true, List.of(new OutputField("txId", "transaction_id")), List.of(input("hr_id", "hr"))));
        SavedQuery byTx = query("SELECT * FROM employee_transaction WHERE transaction_id = ?", param("transaction_id"));
        Workflow microB = create("microB", List.of(new WorkflowInput("tx", "TX", ParamType.STRING, true)),
                queryStep(1, byTx, true, List.of(), List.of(input("transaction_id", "tx"))));
        Workflow big = create("big", List.of(new WorkflowInput("customer", "Customer", ParamType.STRING, true)),
                workflowStep(1, microA, true, input("hr", "customer")),
                workflowStep(2, microB, true, new ParamMapping("tx", SourceType.STEP_OUTPUT, "1", "txId", null)));

        assertTrue(workflows.get(big.id()).steps().get(0).isWorkflow());
        assertEquals(microA.name(), workflows.get(big.id()).steps().get(0).subWorkflowName());

        RunView r = executor.runNow(big.id(), Map.of("customer", "HR1"), null, null);
        assertEquals("SUCCESS", r.status(), r.steps().toString());
        StepRunView s1 = step(r, 1);
        assertEquals("SUCCESS", s1.status(), s1.error());
        assertEquals(1, s1.children().size(), "the micro workflow's steps are visible under the parent step");
        assertEquals("T1", String.valueOf(s1.outputs().get("txId")), "child step outputs become the parent step's outputs (first row, oldest id)");
        assertEquals("HR1", s1.params().get("hr"));
        StepRunView s2 = step(r, 2);
        assertEquals("SUCCESS", s2.status(), s2.error());
        assertEquals("T1", s2.params().get("tx"), "value passed from micro workflow 1 into micro workflow 2");
        assertEquals(1, s2.children().get(0).result().rowCount());
    }

    @Test
    void aFailingMicroWorkflowFailsTheParentStepAndStopsTheBigOne() {
        SavedQuery bad = query("SELECT * FROM table_that_does_not_exist WHERE x = ?", param("x"));
        Workflow micro = create("bad", List.of(new WorkflowInput("v", "V", ParamType.STRING, true)), queryStep(1, bad, true, List.of(), List.of(input("x", "v"))));
        SavedQuery ok = query("SELECT * FROM employee_transaction WHERE hr_id = ?", param("hr_id"));
        Workflow after = create("after", List.of(new WorkflowInput("hr", "HR", ParamType.STRING, true)), queryStep(1, ok, true, List.of(), List.of(input("hr_id", "hr"))));
        Workflow big = create("bigfail", List.of(new WorkflowInput("c", "C", ParamType.STRING, true)),
                workflowStep(1, micro, true, input("v", "c")), workflowStep(2, after, true, input("hr", "c")));
        RunView r = executor.runNow(big.id(), Map.of("c", "HR1"), null, null);
        assertEquals("FAILED", r.status());
        assertEquals("FAILED", step(r, 1).status());
        assertTrue(step(r, 1).error().contains("did not complete") && step(r, 1).error().contains("Step 1"), step(r, 1).error());
        assertEquals("SKIPPED", step(r, 2).status());
    }

    @Test
    void missingChildInputsBlockTheStepBeforeAnythingRuns() {
        SavedQuery ok = query("SELECT * FROM employee_transaction WHERE hr_id = ?", param("hr_id"));
        Workflow micro = create("needs", List.of(new WorkflowInput("hr", "HR id", ParamType.STRING, true)), queryStep(1, ok, true, List.of(), List.of(input("hr_id", "hr"))));
        Workflow big = create("bigblock", List.of(new WorkflowInput("c", "C", ParamType.STRING, false)), workflowStep(1, micro, true));
        RunView r = executor.runNow(big.id(), Map.of(), null, null);
        assertEquals("BLOCKED", step(r, 1).status());
        assertTrue(step(r, 1).error().contains("HR id"), step(r, 1).error());
    }

    @Test
    void nestedWorkflowsShareVariables() {
        SavedQuery producer = query("SELECT * FROM employee_transaction WHERE hr_id = ? ORDER BY id", param("hr_id"), new QueryExtraction("firstTx", "transaction_id", false, null));
        Workflow micro = create("producer", List.of(new WorkflowInput("hr", "HR", ParamType.STRING, true)), queryStep(1, producer, true, List.of(), List.of(input("hr_id", "hr"))));
        SavedQuery consumer = query("SELECT * FROM employee_transaction WHERE transaction_id = ?", param("transaction_id"));
        WorkflowStep consume = queryStep(2, consumer, true, List.of(), List.of(new ParamMapping("transaction_id", SourceType.CONSTANT, null, null, "{{firstTx}}")));
        Workflow big = create("shared", List.of(new WorkflowInput("c", "C", ParamType.STRING, true)), workflowStep(1, micro, true, input("hr", "c")), consume);
        RunView r = executor.runNow(big.id(), Map.of("c", "HR1"), null, null);
        assertEquals("SUCCESS", r.status(), step(r, 2).error());
        assertEquals(1, step(r, 2).result().rowCount(), "a variable saved inside the micro workflow is visible to the next step of the big one");
    }

    @Test
    void workflowsCannotContainThemselvesLoopOrNestTooDeep() {
        SavedQuery q = query("SELECT 1", null);
        Workflow a = create("a", List.of(), queryStep(1, q, false, List.of(), List.of()));
        Workflow b = create("b", List.of(), workflowStep(1, a, false));
        // a -> b would create a loop: b already contains a
        assertThrows(ApiException.class, () -> workflows.update(a.id(), new Workflow(a.id(), a.name(), "", List.of(), List.of(workflowStep(1, b, false)))));
        assertThrows(ApiException.class, () -> workflows.update(a.id(), new Workflow(a.id(), a.name(), "", List.of(), List.of(workflowStep(1, a, false)))), "self reference");
        // a chain deeper than the limit is rejected
        Workflow cur = b;
        for (int i = 0; i < 4; i++) cur = create("chain" + i, List.of(), workflowStep(1, cur, false)); // depth now 5 below the top
        Workflow top = cur;
        assertThrows(ApiException.class, () -> create("toodeep", List.of(), workflowStep(1, top, false)));
    }

    @Test
    void usedWorkflowsCannotBeDeletedAndFoldersKeepMainAndMicroFlowsApart() {
        SavedQuery q = query("SELECT 1", null);
        var main = folders.create("WORKFLOW", 0L, "Main Business Flows " + UUID.randomUUID().toString().substring(0, 4));
        var micro = folders.create("WORKFLOW", 0L, "Micro Business Flows " + UUID.randomUUID().toString().substring(0, 4));
        Workflow m = workflows.create(new Workflow(null, "m" + UUID.randomUUID(), "", List.of(), List.of(queryStep(1, q, false, List.of(), List.of())), micro.id()));
        Workflow parent = workflows.create(new Workflow(null, "p" + UUID.randomUUID(), "", List.of(), List.of(workflowStep(1, m, false)), main.id()));
        assertEquals(micro.id(), workflows.get(m.id()).folderId());
        assertEquals(main.id(), workflows.get(parent.id()).folderId());
        ApiException e = assertThrows(ApiException.class, () -> workflows.delete(m.id()));
        assertTrue(e.getMessage().contains(parent.name()), e.getMessage());
        workflows.move(m.id(), main.id());
        assertEquals(main.id(), workflows.get(m.id()).folderId());
        assertThrows(ApiException.class, () -> workflows.move(m.id(), folders.create("REQUEST", 0L, "x" + UUID.randomUUID().toString().substring(0, 4)).id()), "folder of another area");
        folders.delete(main.id());
        assertEquals(0L, workflows.get(parent.id()).folderId(), "deleting a folder moves its workflows to Unfiled");
        workflows.delete(parent.id());
        workflows.delete(m.id());
    }
}
