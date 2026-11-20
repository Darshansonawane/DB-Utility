package com.qa.utility.workflow;

import com.qa.utility.automation.ApiAutomationService;
import com.qa.utility.automation.ApiDtos.ApiRequestDef;
import com.qa.utility.dto.WorkflowDtos.RunForm;
import com.qa.utility.dto.WorkflowDtos.RunParam;
import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.dto.WorkflowDtos.StepRunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.WorkflowRepository;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.*;

/** Runtime inputs and flexible variables: override > automatic > default > empty, retained responses, step references. */
class RuntimeInputsTest extends AbstractDbTest {
    @Autowired WorkflowExecutor executor;
    @Autowired WorkflowService service;
    @Autowired WorkflowRepository repo;
    @Autowired QueryLibraryService library;
    @Autowired ApiAutomationService apiService;

    HttpServer server;
    final List<String> requestedPaths = new CopyOnWriteArrayList<>();

    @BeforeEach
    void startServer() throws Exception {
        db.update("INSERT INTO employee_transaction VALUES (10,'HR-A','T-A','2024-01-01'),(11,'HR-B','T-B','2024-01-02'),(12,'HR-C','T-C','2024-01-03')");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            requestedPaths.add(ex.getRequestURI().toString());
            String body = ex.getRequestURI().getPath().startsWith("/wallets")
                    ? "{\"data\":{\"items\":[{\"id\":\"A1\",\"tags\":[\"x\",\"y\"]},{\"id\":\"B2\"}],\"wallet\":{\"id\":77,\"owner\":{\"name\":\"Asha\"}}},\"ok\":true}"
                    : "{\"echo\":\"" + ex.getRequestURI().getPath() + "\"}";
            byte[] b = body.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b);
            ex.close();
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    // ---------------------------------------------------------------- helpers
    SavedQuery echo(String sql, boolean required, String def) {
        return library.create(new SavedQuery(null, "rt" + UUID.randomUUID(), "", "T", sql, QueryType.READ, List.of(), true,
                List.of(new QueryParameter("v", "Value", ParamType.STRING, required, def))));
    }

    SavedQuery rows(String name) {
        return library.create(new SavedQuery(null, name + UUID.randomUUID(), "", "T", "SELECT id, hr_id, transaction_id FROM employee_transaction WHERE id >= 10 ORDER BY id",
                QueryType.READ, List.of(), true, List.of()));
    }

    static WorkflowStep step(int order, SavedQuery q, List<Integer> deps, List<OutputField> outs, ParamMapping... maps) {
        return new WorkflowStep(null, order, "step " + order, null, q.id(), null, deps, 0, 0, false, outs, List.of(maps));
    }

    static ParamMapping constant(String p, String v) {
        return new ParamMapping(p, SourceType.CONSTANT, null, null, v);
    }

    static ParamMapping fromStep(String p, int step, String field) {
        return new ParamMapping(p, SourceType.STEP_OUTPUT, String.valueOf(step), field, null);
    }

    static ParamMapping fromInput(String p, String input) {
        return new ParamMapping(p, SourceType.INPUT, input, null, null);
    }

    long workflow(List<WorkflowInput> inputs, WorkflowStep... steps) {
        return repo.insert(new Workflow(null, "rt" + UUID.randomUUID(), "", inputs, List.of(steps)));
    }

    static StepRunView at(RunView r, int order) {
        return r.steps().stream().filter(s -> s.order() == order).findFirst().orElseThrow();
    }

    static Object cell(StepRunView s) {
        return s.result().rows().get(0).get(0);
    }

    // ---------------------------------------------------------------- resolution priority
    @Test
    void aStepSavesAColumnIntoAVariableThatALaterStepUses() {
        SavedQuery rows = rows("rows"), echo = echo("SELECT CAST(? AS VARCHAR(50)) AS v", true, null);
        String var = "savedHr" + UUID.randomUUID().toString().substring(0, 8);
        WorkflowStep first = new WorkflowStep(null, 1, "rows", null, rows.id(), null, List.of(), 0, 0, false, List.of(), List.of(),
                "QUERY", null, null, null, null, null, List.of(new QueryExtraction(var, "hr_id", false, null)));
        long id = workflow(List.of(), first, step(2, echo, List.of(1), List.of(), constant("v", "{{" + var + "}}")));
        assertEquals(1, repo.findById(id).orElseThrow().steps().get(0).saveVariables().size(), "the step's variable save is stored");
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("SUCCESS", at(r, 1).status());
        assertEquals("HR-A", cell(at(r, 2)), "the later step read the value saved by step 1 from the first result row");
    }

    @Test
    void runtimeOverrideBeatsAutomaticBeatsDefaultBeatsEmpty() {
        SavedQuery rows = rows("rows"), withDefault = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, "DEFAULT-V"), optional = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, null);
        long id = workflow(List.of(),
                step(1, rows, List.of(), List.of()),                                          // no outputs declared at all
                step(2, withDefault, List.of(1), List.of(), fromStep("v", 1, "hr_id")),       // automatic (first-row column), default available
                step(3, withDefault, List.of(), List.of(), fromStep("v", 1, "no_such_field")), // automatic value missing -> default
                step(4, withDefault, List.of(), List.of()),                                               // nothing mapped -> default
                step(5, optional, List.of(), List.of()));                                                 // optional, nothing at all -> empty

        RunView plain = executor.runNow(id, Map.of(), null, null);
        assertEquals("HR-A", cell(at(plain, 2)), "automatic value from the earlier step");
        assertEquals("Step 1 -> hr_id", at(plain, 2).paramSources().get("v"));
        assertEquals("DEFAULT-V", cell(at(plain, 3)), "automatic value not available: the default");
        assertTrue(at(plain, 3).paramSources().get("v").startsWith("Default value"));
        assertEquals("DEFAULT-V", cell(at(plain, 4)));
        assertEquals("SUCCESS", at(plain, 5).status(), "an optional value with nothing behind it just stays empty");
        assertNull(cell(at(plain, 5)));

        RunView overridden = executor.runNow(id, Map.of(), Map.of(2, Map.of("v", "RUNTIME"), 3, Map.of("v", "RT3"), 4, Map.of("v", "RT4"), 5, Map.of("v", "RT5")), null);
        assertEquals("RUNTIME", cell(at(overridden, 2)), "override beats the automatic value");
        assertEquals("RT3", cell(at(overridden, 3)), "override beats the default");
        assertEquals("RT4", cell(at(overridden, 4)));
        assertEquals("RT5", cell(at(overridden, 5)), "an optional value can be supplied at run time");
        assertEquals("Manual override", at(overridden, 2).paramSources().get("v"));

        // an override applies to its own run only
        RunView again = executor.runNow(id, Map.of(), null, null);
        assertEquals("HR-A", cell(at(again, 2)));
    }

    @Test
    void anOptionalMappedValueThatIsNotThereNeverBlocksButARequiredOneDoes() {
        SavedQuery none = library.create(new SavedQuery(null, "none" + UUID.randomUUID(), "", "T", "SELECT id, hr_id FROM employee_transaction WHERE id = -1", QueryType.READ, List.of(), true, List.of()));
        SavedQuery optional = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, null), required = echo("SELECT CAST(? AS VARCHAR(50)) AS v", true, null);
        long id = workflow(List.of(),
                step(1, none, List.of(), List.of()),
                step(2, optional, List.of(), List.of(), fromStep("v", 1, "hr_id")),
                step(3, required, List.of(), List.of(), fromStep("v", 1, "hr_id")));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("NO_DATA", at(r, 1).status());
        assertEquals("SUCCESS", at(r, 2).status(), "optional + automatic value missing: runs with an empty value");
        assertEquals("BLOCKED", at(r, 3).status(), "required + nothing available: genuinely missing, so it blocks");
        assertTrue(at(r, 3).error().contains("step 1 returned no records"));
        // ...and supplying the value at run time unblocks it
        RunView fixed = executor.runNow(id, Map.of(), Map.of(3, Map.of("v", "typed by hand")), null);
        assertEquals("typed by hand", cell(at(fixed, 3)));
    }

    @Test
    void aRequiredWorkflowInputOnlyBlocksTheStepsThatNeedIt() {
        SavedQuery uses = echo("SELECT CAST(? AS VARCHAR(50)) AS v", true, null), independent = rows("independent");
        long id = workflow(List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true)),
                step(1, uses, List.of(), List.of(), fromInput("v", "customerId")),
                step(2, independent, List.of(), List.of()));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("BLOCKED", at(r, 1).status());
        assertEquals("SUCCESS", at(r, 2).status(), "the run is not refused as a whole");
    }

    // ---------------------------------------------------------------- workflow input defaults
    @Test
    void workflowInputDefaultsFillInWhenNothingIsGivenAndRuntimeValuesWin() {
        SavedQuery q = echo("SELECT CAST(? AS VARCHAR(50)) AS v", true, null);
        long id = workflow(List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true, "C-DEFAULT")), step(1, q, List.of(), List.of(), fromInput("v", "customerId")));
        RunView byDefault = executor.runNow(id, Map.of(), null, null);
        assertEquals("C-DEFAULT", cell(at(byDefault, 1)));
        assertEquals("C-DEFAULT", byDefault.inputs().get("customerId"));
        assertEquals("C-RUNTIME", cell(at(executor.runNow(id, Map.of("customerId", "C-RUNTIME"), null, null), 1)));
        assertEquals("C-DEFAULT", cell(at(executor.runNow(id, Map.of("customerId", "  "), null, null), 1)), "a blank value counts as not given");
    }

    @Test
    void defaultsAreTypeCheckedAndOnlyChangeWhenExplicitlySaved() {
        SavedQuery q = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, null);
        assertThrows(ApiException.class, () -> service.create(new Workflow(null, "bad default " + UUID.randomUUID(), "", List.of(new WorkflowInput("n", "N", ParamType.INTEGER, false, "abc")), List.of())));
        long id = workflow(List.of(new WorkflowInput("n", "N", ParamType.INTEGER, false, "5")), step(1, q, List.of(), List.of(), fromInput("v", "n")));
        executor.runNow(id, Map.of("n", "99"), null, null);
        assertEquals("5", repo.findById(id).orElseThrow().inputs().get(0).defaultValue(), "a run-time value never changes the saved default");
        service.saveInputDefaults(id, Map.of("n", "42"));
        assertEquals("42", repo.findById(id).orElseThrow().inputs().get(0).defaultValue());
        assertEquals("42", cell(at(executor.runNow(id, Map.of(), null, null), 1)));
        assertThrows(ApiException.class, () -> service.saveInputDefaults(id, Map.of("n", "not a number")));
        assertThrows(ApiException.class, () -> service.saveInputDefaults(id, Map.of("unknown", "1")));
        service.saveInputDefaults(id, Map.of("n", ""));
        assertNull(repo.findById(id).orElseThrow().inputs().get(0).defaultValue(), "a blank value clears the default");
    }

    @Test
    void anInputWithoutADefaultStaysExactlyAsBefore() {
        long id = workflow(List.of(new WorkflowInput("a", "A", ParamType.STRING, false)), step(1, rows("r"), List.of(), List.of()));
        Workflow w = repo.findById(id).orElseThrow();
        assertNull(w.inputs().get(0).defaultValue());
        assertFalse(w.inputs().get(0).hasDefault());
        assertEquals("SUCCESS", executor.runNow(id, Map.of(), null, null).status());
    }

    // ---------------------------------------------------------------- retained responses and paths
    @Test
    void databaseResponsesAreRetainedAndAnyRowOrColumnIsReachableWithoutOutputDefinitions() {
        SavedQuery rows = rows("rows"), e = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, null);
        long id = workflow(List.of(),
                step(1, rows, List.of(), List.of()),
                step(2, e, List.of(1), List.of(), fromStep("v", 1, "rows.1.hr_id")),
                step(3, e, List.of(1), List.of(), fromStep("v", 1, "rows[2].transaction_id")),
                step(4, e, List.of(1), List.of(), fromStep("v", 1, "rowCount")),
                step(5, e, List.of(1), List.of(), constant("v", "id={{step1.rows.2.id}} first={{step1.hr_id}}")));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("HR-B", cell(at(r, 2)), "second row by path");
        assertEquals("T-C", cell(at(r, 3)), "bracket syntax works too");
        assertEquals("3", cell(at(r, 4)));
        assertEquals("id=12 first=HR-A", cell(at(r, 5)), "{{stepN.path}} references work inside any value, mixed with plain text");
    }

    @Test
    void apiResponsesAreRetainedAutomaticallyAndDynamicStructuresAreReachable() {
        long wallets = apiService.saveRequest(null, new ApiRequestDef(null, "wallets " + UUID.randomUUID(), "", "GET", "http://127.0.0.1:" + server.getAddress().getPort() + "/wallets", List.of(), null, List.of(), null)).id();
        long echoReq = apiService.saveRequest(null, new ApiRequestDef(null, "echo " + UUID.randomUUID(), "", "GET", "http://127.0.0.1:" + server.getAddress().getPort() + "/echo/{{step1.data.wallet.id}}/{{step1.data.items.1.id}}", List.of(), null, List.of(), null)).id();
        SavedQuery e = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, null);
        long id = workflow(List.of(),
                new WorkflowStep(null, 1, "call wallets API", null, 0, null, List.of(), 0, 0, false, List.of(), List.of(), "API_REQUEST", wallets, null, null),   // no extractions, no outputs
                step(2, e, List.of(1), List.of(), fromStep("v", 1, "data.items.1.id")),
                step(3, e, List.of(1), List.of(), fromStep("v", 1, "data.wallet.owner.name")),
                step(4, e, List.of(1), List.of(), constant("v", "wallet {{step1.data.wallet.id}} tag {{step1.data.items.0.tags.1}}")),
                step(5, e, List.of(1), List.of(), fromStep("v", 1, "http_status")),
                new WorkflowStep(null, 6, "call echo API using the first response", null, 0, null, List.of(1), 0, 0, false, List.of(), List.of(), "API_REQUEST", echoReq, null, null),
                step(7, e, List.of(6), List.of(), fromStep("v", 6, "echo")));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("SUCCESS", r.status(), r.steps().toString());
        assertEquals("B2", cell(at(r, 2)), "array element of the API response");
        assertEquals("Asha", cell(at(r, 3)), "nested object of the API response");
        assertEquals("wallet 77 tag y", cell(at(r, 4)));
        assertEquals("200", cell(at(r, 5)));
        assertTrue(requestedPaths.contains("/echo/77/B2"), "the second API call used values from the first response: " + requestedPaths);
        assertEquals("/echo/77/B2", cell(at(r, 7)), "and its own response is retained too");
    }

    @Test
    void unfinishedStepsAreNotReferencedAndUnknownPathsGiveAClearMessage() {
        SavedQuery rows = rows("rows"), e = echo("SELECT CAST(? AS VARCHAR(50)) AS v", true, null);
        long id = workflow(List.of(), step(1, rows, List.of(), List.of()), step(2, e, List.of(1), List.of(), fromStep("v", 1, "rows.9.hr_id")));
        RunView r = executor.runNow(id, Map.of(), null, null);
        assertEquals("BLOCKED", at(r, 2).status());
        assertTrue(at(r, 2).error().contains("has no field 'rows.9.hr_id'") && at(r, 2).error().contains("path into the response"), at(r, 2).error());
    }

    @Test
    void stepReferencesInsideANestedWorkflowPointAtItsOwnStepsAndTheParentIsRestored() {
        SavedQuery rows = rows("rows"), e = echo("SELECT CAST(? AS VARCHAR(50)) AS v", false, "child-default");
        long childId = repo.insert(new Workflow(null, "child " + UUID.randomUUID(), "", List.of(new WorkflowInput("tag", "Tag", ParamType.STRING, false, "CHILD-IN-DEFAULT")), List.of(
                step(1, e, List.of(), List.of(), fromInput("v", "tag")),
                step(2, e, List.of(1), List.of(), constant("v", "child sees {{step1.v}}")))));
        long parent = repo.insert(new Workflow(null, "parent " + UUID.randomUUID(), "", List.of(), List.of(
                step(1, rows, List.of(), List.of()),
                new WorkflowStep(null, 2, "run child", null, 0, null, List.of(1), 0, 0, false, List.of(), List.of(), "WORKFLOW", null, null, null, childId, null),
                step(3, e, List.of(2), List.of(), constant("v", "parent sees {{step1.hr_id}}")))));
        RunView r = executor.runNow(parent, Map.of(), null, null);
        assertEquals("SUCCESS", r.status(), r.steps().toString());
        assertEquals("CHILD-IN-DEFAULT", cell(at(r, 2).children().get(0)), "the child's own input default (parent did not map it)");
        assertEquals("child sees CHILD-IN-DEFAULT", cell(at(r, 2).children().get(1)), "step numbers inside the child refer to the child's steps");
        assertEquals("parent sees HR-A", cell(at(r, 3)), "after the child ran, step numbers refer to the parent's steps again");
    }

    // ---------------------------------------------------------------- the run form
    @Test
    void theRunFormDescribesWhereEveryValueComesFrom() {
        SavedQuery two = library.create(new SavedQuery(null, "two" + UUID.randomUUID(), "", "T", "SELECT CAST(? AS VARCHAR(20)) AS a, CAST(? AS VARCHAR(20)) AS b, CAST(? AS VARCHAR(20)) AS c, CAST(? AS VARCHAR(20)) AS d, CAST(? AS VARCHAR(20)) AS e",
                QueryType.READ, List.of(), true, List.of(new QueryParameter("a", "A", ParamType.STRING, true, null), new QueryParameter("b", "B", ParamType.STRING, true, null),
                new QueryParameter("c", "C", ParamType.INTEGER, false, "7"), new QueryParameter("d", "D", ParamType.STRING, false, null), new QueryParameter("e", "E", ParamType.DATE, false, null))));
        long id = workflow(List.of(new WorkflowInput("cust", "Customer", ParamType.STRING, true, "C1"), new WorkflowInput("when", "When", ParamType.DATE, false)),
                step(1, rows("r"), List.of(), List.of()),
                step(2, two, List.of(1), List.of(), fromStep("a", 1, "hr_id"), fromInput("b", "cust"), constant("e", "2026-01-31")));
        RunForm form = service.runForm(id);
        assertEquals(List.of("cust", "when"), form.inputs().stream().map(i -> i.name()).toList());
        assertEquals("C1", form.inputs().get(0).defaultValue());
        assertEquals("DATE", form.inputs().get(1).type());
        Map<String, RunParam> p = new java.util.HashMap<>();
        form.steps().get(1).params().forEach(x -> p.put(x.name(), x));
        assertEquals("AUTOMATIC", p.get("a").sourceKind());
        assertEquals("Step 1 -> hr_id", p.get("a").source());
        assertEquals("WORKFLOW_INPUT", p.get("b").sourceKind());
        assertEquals("cust", p.get("b").inputRef());
        assertEquals("DEFAULT", p.get("c").sourceKind());
        assertEquals("7", p.get("c").defaultValue());
        assertEquals("INTEGER", p.get("c").type());
        assertEquals("NONE", p.get("d").sourceKind());
        assertFalse(p.get("d").required());
        assertEquals("CONSTANT", p.get("e").sourceKind());
        assertEquals("2026-01-31", p.get("e").constant());
        assertTrue(form.steps().get(0).params().isEmpty());
    }
}
