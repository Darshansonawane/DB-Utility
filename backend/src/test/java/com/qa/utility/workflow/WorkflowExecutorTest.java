package com.qa.utility.workflow;

import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.HistoryRepository;
import com.qa.utility.repository.WorkflowRepository;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class WorkflowExecutorTest extends AbstractDbTest {
    @Autowired
    WorkflowExecutor executor;
    @Autowired
    WorkflowRepository workflows;
    @Autowired
    HistoryRepository history;
    @Autowired
    QueryLibraryService library;
    @Autowired
    JdbcTemplate meta;

    long wfId;

    @BeforeEach
    void seedBusinessData() {
        wfId = workflows.findByName(SavingsWalletSeeder.WORKFLOW_NAME).orElseThrow().id();
        db.update("INSERT INTO bank_wallet.savings_wallet_schedule VALUES (1,'C100','2024-04-01'),(2,'C100','2024-05-01'),(3,'C999','2024-05-01')");
        db.update("INSERT INTO bank_wallet.savings_wallet_contributors_details VALUES (1,'CT7','CLIENT-A'),(2,'CT8','CLIENT-B')");
        db.update("INSERT INTO BankInstruction.debit_instruction VALUES (1,'CLIENT-A','2024-05-01','PENDING'),(2,'CLIENT-B','2024-05-02','DONE')");
        db.update("INSERT INTO bank_wallet.savings_wallet_contributions VALUES (1,'CT7','2024-05-01')");
        db.update("INSERT INTO BankInstruction.bank_payment_master VALUES (50,'CLIENT-A','2024-04-30'),(60,'CLIENT-B','2024-04-30')");
        db.update("INSERT INTO BankInstruction.bank_payment_child VALUES (1,50,'COMPLETED'),(2,60,'FAILED')");
        db.update("INSERT INTO bank_wallet.savings_wallet_details VALUES (1,'C100','GOAL_ACTIVE','TERM_ACTIVE')");
    }

    private static StepRunView step(RunView r, int order) {
        return r.steps().stream().filter(s -> s.order() == order).findFirst().orElseThrow();
    }

    @Test
    void seededWorkflowPassesIdsBetweenStepsAutomatically() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "CT7"), null, null);
        assertEquals("SUCCESS", r.status());
        r.steps().forEach(s -> assertEquals("SUCCESS", s.status(), "step " + s.order() + ": " + s.error()));
        // Step 3 and 5 received the client unique id read from step 2
        assertEquals("CLIENT-A", step(r, 3).params().get("client_unique_id"));
        assertEquals("Step 2 -> clientUniqueId", step(r, 3).paramSources().get("client_unique_id"));
        assertEquals("CLIENT-A", step(r, 5).params().get("client_unique_id"));
        // Step 6 received the payment master id read from step 5
        assertEquals("50", step(r, 6).params().get("bank_payment_master_id"));
        assertEquals("COMPLETED", step(r, 6).result().rows().get(0).get(2));
        // Step 1 and 7 use the initial customer id; step 4 the contributor id
        assertEquals("C100", step(r, 1).params().get("customer_id"));
        assertEquals("C100", step(r, 7).params().get("customer_id"));
        assertEquals("CT7", step(r, 4).params().get("contributor_id"));
        assertEquals(2, step(r, 1).result().rowCount());
        assertEquals("2", String.valueOf(step(r, 1).outputs().get("scheduleId")), "step 1 returns newest first");
    }

    @Test
    void runsDoNotShareState() {
        RunView a = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "CT7"), null, null);
        RunView b = executor.runNow(wfId, Map.of("customerId", "C999", "contributorId", "CT8"), null, null);
        assertEquals("CLIENT-A", step(a, 3).params().get("client_unique_id"));
        assertEquals("CLIENT-B", step(b, 3).params().get("client_unique_id"));
        assertEquals("60", step(b, 6).params().get("bank_payment_master_id"));
        assertEquals("NO_DATA", step(b, 7).status(), "C999 has no wallet details row: missing record shown, not an error");
    }

    @Test
    void missingUpstreamDataBlocksDependentSteps() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "UNKNOWN"), null, null);
        assertEquals("NO_DATA", step(r, 2).status());
        assertEquals("BLOCKED", step(r, 3).status());
        assertTrue(step(r, 3).error().contains("Upstream step 2") || step(r, 3).error().contains("returned no records"), step(r, 3).error());
        assertEquals("BLOCKED", step(r, 5).status());
        assertEquals("BLOCKED", step(r, 6).status());
        assertEquals("SUCCESS", step(r, 1).status());
        assertEquals("SUCCESS", step(r, 7).status());
        assertEquals("PARTIAL", r.status());
    }

    @Test
    void manualOverrideUnblocksStepAndIsRecordedAsSource() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "UNKNOWN"), null, null);
        // provide client unique id manually for step 3, then rerun just that step
        RunView after = executor.executeNow(r.runId(), List.of(3), Map.of(3, Map.of("client_unique_id", "CLIENT-B")));
        assertEquals("SUCCESS", step(after, 3).status());
        assertEquals("Manual override", step(after, 3).paramSources().get("client_unique_id"));
        assertEquals("DONE", step(after, 3).result().rows().get(0).get(3));
    }

    @Test
    void individualStepOnlyRunsThatStep() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "CT7"), null, List.of(2));
        assertEquals("SUCCESS", step(r, 2).status());
        assertEquals("PENDING", step(r, 1).status());
        assertEquals("PENDING", step(r, 3).status());
        assertEquals("INCOMPLETE", r.status());
        // running step 3 individually now works because step 2 is complete in this run
        RunView r3 = executor.executeNow(r.runId(), List.of(3), null);
        assertEquals("SUCCESS", step(r3, 3).status());
    }

    @Test
    void rerunningUpstreamStepInvalidatesDownstreamSteps() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "CT7"), null, null);
        RunView after = executor.executeNow(r.runId(), List.of(2), null);
        assertEquals("SUCCESS", step(after, 2).status());
        assertEquals("PENDING", step(after, 3).status());
        assertEquals("PENDING", step(after, 6).status());
        assertEquals("SUCCESS", step(after, 1).status());
        RunView resumed = executor.executeNow(r.runId(), null, null); // resume = all not-yet-completed steps
        assertEquals("SUCCESS", resumed.status());
    }

    @Test
    void failedStepIsReportedAndLaterIndependentStepsStillRun() {
        db.execute("DROP TABLE bank_wallet.savings_wallet_contributions");
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100", "contributorId", "CT7"), null, null);
        assertEquals("FAILED", step(r, 4).status());
        assertTrue(step(r, 4).error().startsWith("SQL error"));
        assertEquals("SUCCESS", step(r, 5).status());
        assertEquals("SUCCESS", step(r, 7).status());
        assertEquals("FAILED", r.status());
        String failed = meta.queryForObject("SELECT failed_steps FROM workflow_run WHERE id = ?", String.class, r.runId());
        assertEquals("4", failed);
    }

    @Test
    void requiredInputMissingBlocksStepsThatNeedIt() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C100"), null, null);
        assertEquals("BLOCKED", step(r, 2).status());
        assertTrue(step(r, 2).error().contains("not provided"));
        assertEquals("BLOCKED", step(r, 3).status());
        assertEquals("SUCCESS", step(r, 1).status());
    }

    @Test
    void invalidMappingColumnGivesActionableMessage() {
        Workflow w = workflows.findById(wfId).orElseThrow();
        WorkflowStep s2 = w.steps().get(1);
        WorkflowStep s3 = w.steps().get(2);
        // step 3 now asks for a column that step 2 does not return
        WorkflowStep badMap = new WorkflowStep(null, 3, s3.name(), null, s3.queryId(), null, List.of(2), 0, 0, false, List.of(),
                List.of(new ParamMapping("client_unique_id", SourceType.STEP_OUTPUT, "2", "no_such_column", null)));
        Workflow copy = new Workflow(null, "copy" + UUID.randomUUID(), "", w.inputs(),
                List.of(new WorkflowStep(null, 2, s2.name(), null, s2.queryId(), null, List.of(), 0, 0, false, List.of(), s2.mappings()), badMap));
        long id = workflows.insert(copy);
        RunView r = executor.runNow(id, Map.of("customerId", "C100", "contributorId", "CT7"), null, null);
        assertEquals("BLOCKED", step(r, 3).status());
        assertTrue(step(r, 3).error().contains("no_such_column") && step(r, 3).error().contains("available"), step(r, 3).error());
    }

    @Test
    void retryIsAttemptedForFailingStep() {
        db.execute("DROP TABLE bank_wallet.savings_wallet_details");
        Workflow w = workflows.findById(wfId).orElseThrow();
        WorkflowStep s7 = w.steps().get(6);
        Workflow copy = new Workflow(null, "retry" + UUID.randomUUID(), "", w.inputs(), List.of(
                new WorkflowStep(null, 1, "x", null, s7.queryId(), null, List.of(), 2, 10, false, List.of(), s7.mappings())));
        long id = workflows.insert(copy);
        RunView r = executor.runNow(id, Map.of("customerId", "C100"), null, null);
        assertEquals("FAILED", step(r, 1).status());
        assertEquals(3, step(r, 1).attempts());
    }

    @Test
    void stopOnFailureSkipsRemainingSteps() {
        db.execute("DROP TABLE bank_wallet.savings_wallet_schedule");
        Workflow w = workflows.findById(wfId).orElseThrow();
        WorkflowStep s1 = w.steps().get(0);
        WorkflowStep s7 = w.steps().get(6);
        Workflow copy = new Workflow(null, "stop" + UUID.randomUUID(), "", w.inputs(), List.of(
                new WorkflowStep(null, 1, "a", null, s1.queryId(), null, List.of(), 0, 0, true, List.of(), s1.mappings()),
                new WorkflowStep(null, 2, "b", null, s7.queryId(), null, List.of(), 0, 0, false, List.of(), s7.mappings())));
        long id = workflows.insert(copy);
        RunView r = executor.runNow(id, Map.of("customerId", "C100"), null, null);
        assertEquals("FAILED", step(r, 1).status());
        assertEquals("SKIPPED", step(r, 2).status());
    }

    @Test
    void writeQueriesAreNeverRunByTheWorkflowEngine() {
        SavedQuery upd = library.create(new SavedQuery(null, "wf-upd" + UUID.randomUUID(), "", "Test",
                "UPDATE employee_transaction SET hr_id = ? WHERE id = ?", QueryType.WRITE, List.of(), true,
                List.of(new QueryParameter("hr_id", "HR", ParamType.STRING, true, null), new QueryParameter("id", "ID", ParamType.INTEGER, true, null))));
        allowWrites();
        long id = workflows.insert(new Workflow(null, "w" + UUID.randomUUID(), "", List.of(), List.of(
                new WorkflowStep(null, 1, "update", null, upd.id(), null, List.of(), 0, 0, false, List.of(), List.of(
                        new ParamMapping("hr_id", SourceType.CONSTANT, null, null, "HRX"), new ParamMapping("id", SourceType.CONSTANT, null, null, "1"))))));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("FAILED", step(r, 1).status());
        assertEquals("HR1", db.queryForObject("SELECT hr_id FROM employee_transaction WHERE id = 1", String.class));
    }

    @Test
    void historyStoresMaskedIdentifiersOnly() {
        RunView r = executor.runNow(wfId, Map.of("customerId", "C1000123", "contributorId", "CT7"), null, null);
        Map<String, Object> row = meta.queryForMap("SELECT * FROM workflow_run WHERE id = ?", r.runId());
        assertEquals("C1****23", row.get("CUSTOMER_ID_MASKED"));
        assertEquals("CL****-A", row.get("CLIENT_UNIQUE_ID_MASKED"));
        assertFalse(String.valueOf(row.get("INPUTS_MASKED")).contains("C1000123"));
        List<Map<String, Object>> steps = history.stepRuns(r.runId());
        assertEquals(7, steps.size());
        assertTrue(steps.stream().noneMatch(s -> String.valueOf(s.get("INPUTS_MASKED")).contains("CLIENT-A")));
    }

    @Test
    void notConnectedIsRejectedUpFront() {
        target.set(null);
        assertThrows(ApiException.class, () -> executor.runNow(wfId, Map.of(), null, null));
    }
}
