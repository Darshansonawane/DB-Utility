package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.workflow.WorkflowExecutor;
import com.qa.utility.workflow.WorkflowService;
import com.qa.utility.support.AbstractDbTest;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ApiAutomationTest extends AbstractDbTest {
    @Autowired ApiAutomationService service;
    @Autowired VariableService variables;
    @Autowired QueryLibraryService library;
    @Autowired ApiWorkflowService apiWorkflows;
    @Autowired ApiWorkflowRunner runner;
    @Autowired ApiReportService reports;
    @Autowired WorkflowService dbWorkflows;
    @Autowired WorkflowExecutor dbExecutor;
    final AtomicInteger polls = new AtomicInteger();

    HttpServer server;
    String base;
    volatile String lastBody;
    volatile String lastAuth;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/wallets", ex -> {
            lastBody = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            lastAuth = ex.getRequestHeaders().getFirst("Authorization");
            byte[] out = "{\"data\":{\"wallet\":{\"id\":\"HR1\",\"tags\":[{\"n\":\"a\"},{\"n\":\"b\"}]}},\"token\":\"s3cret\"}".getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("X-Trace", "t-42");
            ex.sendResponseHeaders(201, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.createContext("/poll", ex -> {
            int n = polls.incrementAndGet();
            byte[] out = ("{\"state\":\"" + (n < 3 ? "PENDING" : "DONE") + "\",\"id\":\"P" + n + "\"}").getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.createContext("/echo", ex -> {
            byte[] out = ex.getRequestBody().readAllBytes();
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.createContext("/slow", ex -> {
            try { Thread.sleep(400); } catch (InterruptedException ignored) { }
            byte[] out = "{\"ok\":true}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(200, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.createContext("/redir", ex -> {
            ex.getResponseHeaders().add("Location", "http://127.0.0.1:1/x");
            ex.sendResponseHeaders(302, -1);
            ex.close();
        });
        server.setExecutor(Executors.newFixedThreadPool(16));
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
        variables.clear();
        variables.put("tok", "abc123", true, "manual");
    }

    @AfterEach
    void stop() {
        server.stop(0);
        variables.clear();
    }

    private ApiRequestDef req(String url, String body, Extraction... ex) {
        return new ApiRequestDef(null, "r" + UUID.randomUUID(), null, "POST", url, List.of(new Header("Authorization", "Bearer {{tok}}")), body, List.of(ex), null);
    }

    @Test
    void extractsIntoVariablesAndUsesThemInRequestsAndQueries() {
        ApiRunResult r = service.run(req(base + "/wallets", "{\"user\":\"{{u}}\"}".replace("{{u}}", "bob"),
                new Extraction("walletId", "BODY", "data.wallet.id", false),
                new Extraction("secondTag", "BODY", "data.wallet.tags[1].n", false),
                new Extraction("trace", "HEADER", "X-Trace", false),
                new Extraction("apiToken", "BODY", "token", true),
                new Extraction("code", "STATUS", null, false),
                new Extraction("rx", "BODY_REGEX", "\"id\":\"(\\w+)\"", false)));
        assertTrue(r.success(), r.error());
        assertEquals(201, r.status());
        assertEquals("Bearer abc123", lastAuth);
        assertEquals("{\"user\":\"bob\"}", lastBody);
        var byName = r.extracted().stream().collect(java.util.stream.Collectors.toMap(ExtractedValue::variable, ExtractedValue::value));
        assertEquals("HR1", byName.get("walletId"));
        assertEquals("b", byName.get("secondTag"));
        assertEquals("t-42", byName.get("trace"));
        assertEquals("201", byName.get("code"));
        assertEquals("HR1", byName.get("rx"));
        assertEquals(VariableService.MASK, byName.get("apiToken"), "secret extractions are masked in the response");
        assertEquals("s3cret", variables.resolve("{{apiToken}}"));

        // the extracted wallet id feeds a saved query parameter
        SavedQuery q = library.create(new SavedQuery(null, "byWallet" + UUID.randomUUID(), "", "Test",
                "SELECT * FROM employee_transaction WHERE hr_id = ?", QueryType.READ, List.of(), true,
                List.of(new QueryParameter("hr_id", "HR", ParamType.STRING, true, null))));
        var res = library.execute(q.id(), Map.of("hr_id", "{{walletId}}"), null);
        assertTrue(res.rowCount() >= 1, "query ran with the extracted wallet id");
    }

    @Test
    void missingExtractionAndBadStatusFailTheStep() {
        ApiRunResult r = service.run(req(base + "/wallets", null, new Extraction("nope", "BODY", "data.missing", false)));
        assertFalse(r.success());
        assertTrue(r.error().contains("Could not extract 'nope'"));
        assertThrows(ApiException.class, () -> variables.resolve("{{nope}}"));

        ApiRequestDef expects200 = new ApiRequestDef(null, "e", null, "POST", base + "/wallets", List.of(), null, List.of(), 200);
        assertFalse(service.run(expects200).success());
    }

    @Test
    void urlPolicyBlocksProductionLinkLocalAndRedirectsAreNotFollowed() {
        assertFalse(service.run(req("https://api.prod.bank.example/wallets", null)).success());
        assertTrue(service.run(req("https://prod-api.example/wallets", null)).error().contains("blocked pattern"));
        assertTrue(service.run(req("http://169.254.169.254/latest/meta-data", null)).error().contains("link-local"));
        assertTrue(service.run(req("ftp://x/y", null)).error().contains("http"));
        ApiRunResult r = service.run(new ApiRequestDef(null, "redir", null, "GET", base + "/redir", List.of(), null, List.of(), null));
        assertEquals(302, r.status());
        assertFalse(r.success());
    }

    @Test
    void secretsAreMaskedAndBuiltinsWork() {
        variables.put("pw", "hunter2", true, "manual");
        assertEquals("hunter2", variables.resolve("{{pw}}"));
        assertEquals(VariableService.MASK, variables.resolve("{{pw}}", true));
        assertTrue(variables.list().stream().noneMatch(v -> "hunter2".equals(v.value())));
        assertEquals(36, variables.resolve("{{$uuid}}").length());
        assertTrue(variables.resolve("{{ $randomInt }}").matches("\\d{6}"));
        assertThrows(ApiException.class, () -> variables.resolve("{{$unknown}}"));
        assertThrows(ApiException.class, () -> VariableService.validateName("bad name"));
    }

    // ------------------------------------------------------------------ API workflows

    private ApiDtos.ApiRunView await(String runId) throws Exception {
        long end = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < end) {
            ApiDtos.ApiRunView v = runner.get(runId);
            if (!v.status().equals("QUEUED") && !v.status().equals("RUNNING")) return v;
            Thread.sleep(50);
        }
        fail("run did not finish: " + runner.get(runId));
        return null;
    }

    private ApiRequestDef saved(String suffix, String method, String path, String body, Integer expected, Extraction... ex) {
        return service.saveRequest(null, new ApiRequestDef(null, suffix + UUID.randomUUID(), null, method, base + path, List.of(), body, List.of(ex), expected));
    }

    private ApiWfStep step(int order, ApiRequestDef r, String onFailure, ApiStepOptions o) {
        return new ApiWfStep(null, order, "s" + order, r.id(), r.name(), r.method(), onFailure, true, o);
    }

    private ApiWorkflowDef wf(boolean publish, ApiWfStep... steps) {
        return apiWorkflows.save(null, new ApiWorkflowDef(null, "wf" + UUID.randomUUID(), null, publish, 120, List.of(steps)));
    }

    @Test
    void workflowRunsStepsInOrderPassingVariablesAndStopsOnFailure() throws Exception {
        ApiRequestDef a = saved("create", "POST", "/wallets", "{}", null, new Extraction("walletId", "BODY", "data.wallet.id", false));
        ApiRequestDef b = saved("use", "POST", "/wallets?w={{walletId}}", "{}", null);
        ApiRequestDef bad = saved("bad", "GET", "/redir", null, null);
        ApiWorkflowDef ok = wf(false, step(1, a, "STOP", ApiStepOptions.defaults()), step(2, b, "STOP", ApiStepOptions.defaults()));
        ApiDtos.ApiRunView r = await(runner.start(ok.id(), null));
        assertEquals("SUCCESS", r.status(), r.error());
        assertTrue(r.steps().get(1).url().endsWith("?w=HR1"));
        assertThrows(ApiException.class, () -> variables.resolve("{{walletId}}"), "publishGlobal=false keeps variables private to the run");

        ApiWorkflowDef stops = wf(true, step(1, bad, "STOP", ApiStepOptions.defaults()), step(2, a, "STOP", ApiStepOptions.defaults()));
        r = await(runner.start(stops.id(), null));
        assertEquals("FAILED", r.status());
        assertEquals("FAILED", r.steps().get(0).status());
        assertEquals("SKIPPED", r.steps().get(1).status());

        ApiWorkflowDef cont = wf(true, step(1, bad, "CONTINUE", ApiStepOptions.defaults()), step(2, a, "STOP", ApiStepOptions.defaults()));
        r = await(runner.start(cont.id(), null));
        assertEquals("FAILED", r.status(), "a failed step still fails the run");
        assertEquals("SUCCESS", r.steps().get(1).status(), "CONTINUE lets later steps run");
        assertEquals("HR1", variables.resolve("{{walletId}}"), "publishGlobal=true copies extractions to Variables");
        assertThrows(ApiException.class, () -> service.deleteRequest(a.id()));
    }

    @Test
    void waitsBeforeAndPollsUntilTheResponseSatisfiesTheCondition() throws Exception {
        polls.set(0);
        ApiRequestDef p = saved("poll", "GET", "/poll", null, null, new Extraction("polledId", "BODY", "id", false));
        ApiStepOptions opt = new ApiStepOptions(1, 1, 30, 10,
                List.of(new Condition("BODY", "state", "EQUALS", "DONE")), List.of(new Condition("STATUS", null, "EQUALS", "200")));
        ApiWorkflowDef w = wf(false, step(1, p, "STOP", opt));
        long t0 = System.currentTimeMillis();
        ApiDtos.ApiRunView r = await(runner.start(w.id(), null));
        long took = System.currentTimeMillis() - t0;
        assertEquals("SUCCESS", r.status(), r.error());
        assertEquals(3, r.steps().get(0).attempts(), "PENDING, PENDING, DONE");
        assertTrue(took >= 3000, "1s wait + two 1s poll intervals, took " + took);
        assertEquals("P3", r.steps().get(0).extracted().get(0).value());
    }

    @Test
    void pollingGivesUpAfterTheMaxAttemptsAndAssertionsFailTheStep() throws Exception {
        polls.set(-100); // never DONE
        ApiRequestDef p = saved("never", "GET", "/poll", null, null);
        ApiWorkflowDef w = wf(false, step(1, p, "STOP", new ApiStepOptions(0, 1, 30, 2, List.of(new Condition("BODY", "state", "EQUALS", "DONE")), List.of())));
        ApiDtos.ApiRunView r = await(runner.start(w.id(), null));
        assertEquals("FAILED", r.status());
        assertEquals(2, r.steps().get(0).attempts());
        assertTrue(r.steps().get(0).error().contains("gave up after 2"), r.steps().get(0).error());
        assertNotNull(r.steps().get(0).responseSnippet());

        ApiRequestDef ok = saved("assert", "GET", "/poll", null, null);
        polls.set(10);
        ApiWorkflowDef w2 = wf(false, step(1, ok, "STOP", new ApiStepOptions(0, 1, 30, 1, List.of(), List.of(new Condition("BODY", "state", "EQUALS", "NOPE")))));
        r = await(runner.start(w2.id(), null));
        assertEquals("FAILED", r.status());
        assertTrue(r.steps().get(0).error().startsWith("Assertion failed"));
    }

    @Test
    void stopCancelsAWaitingRunPromptly() throws Exception {
        ApiRequestDef p = saved("slowstop", "GET", "/slow", null, null);
        ApiWorkflowDef w = wf(false, step(1, p, "STOP", new ApiStepOptions(60, 1, 30, 1, List.of(), List.of())), step(2, p, "STOP", ApiStepOptions.defaults()));
        String id = runner.start(w.id(), null);
        Thread.sleep(500);
        assertEquals("RUNNING", runner.get(id).status());
        assertTrue(runner.get(id).steps().get(0).liveStatus().startsWith("Waiting"));
        assertTrue(runner.activeRuns().stream().anyMatch(x -> x.runId().equals(id)));
        runner.cancel(id);
        long t0 = System.currentTimeMillis();
        ApiDtos.ApiRunView r = await(id);
        assertTrue(System.currentTimeMillis() - t0 < 3000, "stop must not wait out the 60s pause");
        assertEquals("CANCELLED", r.status());
    }

    @Test
    void manyRunsExecuteConcurrentlyWithIsolatedVariables() throws Exception {
        ApiRequestDef echo = saved("echo", "POST", "/echo", "{\"v\":\"{{who}}\"}", null, new Extraction("echoed", "BODY", "v", false));
        ApiRequestDef slow = saved("slow", "GET", "/slow", null, null);
        ApiRequestDef check = saved("check", "POST", "/echo", "{\"v\":\"{{echoed}}\"}", null);
        ApiStepOptions assertMine = new ApiStepOptions(0, 5, 300, 1, List.of(), List.of(new Condition("BODY", "v", "EQUALS", "{{who}}")));
        ApiWorkflowDef w = wf(false, step(1, echo, "STOP", ApiStepOptions.defaults()), step(2, slow, "STOP", ApiStepOptions.defaults()), step(3, check, "STOP", assertMine));
        List<String> ids = new ArrayList<>();
        long t0 = System.currentTimeMillis();
        for (int i = 0; i < 8; i++) ids.add(runner.start(w.id(), java.util.Map.of("who", "user" + i)));
        for (String id : ids) assertEquals("SUCCESS", await(id).status(), "each run sees only its own {{who}}/{{echoed}}");
        assertTrue(System.currentTimeMillis() - t0 < 8 * 400, "8 runs of a 400 ms step should overlap");

        WorkflowReport rep = reports.report(w.id(), 30);
        assertEquals(8, rep.totalRuns());
        assertEquals(100.0, rep.passRate(), 0.01);
        assertEquals(3, rep.steps().size());
        assertTrue(rep.steps().get(1).avgMs() >= 300);
        String csv = reports.csv(w.id(), 30);
        assertEquals(1 + 8 * 3, csv.split("\n").length);
        assertTrue(reports.overview().stream().anyMatch(o -> o.workflowId().equals(w.id()) && o.runs() == 8));
        assertEquals(8, runner.history(w.id(), 50).size());
    }

    @Test
    void dbWorkflowCanMixApiStepsAndQuerySteps() {
        ApiRequestDef create = saved("hybridcreate", "POST", "/wallets", "{}", null, new Extraction("walletId", "BODY", "data.wallet.id", false));
        SavedQuery q = library.create(new SavedQuery(null, "hybridq" + UUID.randomUUID(), "", "Test", "SELECT * FROM employee_transaction WHERE hr_id = ?",
                QueryType.READ, List.of(), true, List.of(new QueryParameter("hr_id", "HR", ParamType.STRING, true, null))));
        Workflow.WorkflowStep apiStep = new Workflow.WorkflowStep(null, 1, "Create wallet", null, 0, null, List.of(), 0, 0, true, List.of(), List.of(),
                "API_REQUEST", create.id(), null, new ApiStepOptions(0, 1, 10, 1, List.of(), List.of(new Condition("STATUS", null, "EQUALS", "201"))));
        Workflow.WorkflowStep queryStep = new Workflow.WorkflowStep(null, 2, "Find rows", null, q.id(), q.name(), List.of(1), 0, 0, true, List.of(),
                List.of(new Workflow.ParamMapping("hr_id", Workflow.SourceType.STEP_OUTPUT, "1", "walletId", null)));
        Workflow w = dbWorkflows.create(new Workflow(null, "hybrid" + UUID.randomUUID(), "", List.of(), List.of(apiStep, queryStep)));
        assertTrue(w.steps().get(0).isApi());
        assertEquals(create.name(), w.steps().get(0).apiRequestName());
        RunView r = dbExecutor.runNow(w.id(), null, null, null);
        assertEquals("SUCCESS", r.status(), r.steps().toString());
        assertEquals("SUCCESS", r.steps().get(0).status());
        assertEquals("HR1", r.steps().get(0).outputs().get("walletId"));
        assertTrue(r.steps().get(1).result().rowCount() >= 1, "the DB step used the wallet id produced by the API step");
    }

    // ------------------------------------------------------------------ pre-request scripts

    private ApiRequestDef scripted(String script, String body, List<Header> headers, Extraction... ex) {
        return new ApiRequestDef(null, "scr" + UUID.randomUUID(), null, "POST", base + "/echo", headers, body, List.of(ex), null, script);
    }

    @Test
    void preRequestScriptBuildsTheBodyAndSetsVariables() {
        ApiRequestDef def = scripted(
                "var name = 'Darshan' + timestamp();\n"
                        + "vars.set('accountName', name);\n"
                        + "var b = JSON.parse(request.body); b.accountName = name; b.n = randomInt(5, 5); b.id = uuid().length;\n"
                        + "request.body = b;\n"
                        + "request.headers['X-Trace'] = 'T-' + sha256('abc').substring(0, 6);\n"
                        + "console.log('hello', {a: 1});",
                "{\"accountName\":\"x\"}", List.of(new Header("Authorization", "Bearer {{tok}}")),
                new Extraction("sentName", "BODY", "accountName", false), new Extraction("n", "BODY", "n", false));
        ApiRunResult r = service.run(def);
        assertTrue(r.success(), r.error());
        String name = variables.resolve("{{accountName}}");
        assertTrue(name.matches("Darshan\\d{13}"), name);
        assertEquals(name, variables.resolve("{{sentName}}"), "the server received the scripted body");
        assertEquals("5", variables.resolve("{{n}}"));
        assertEquals(List.of("hello {\"a\":1}"), r.scriptLog());
        assertEquals("T-ba7816", r.sent().headers().get("X-Trace"));
        assertEquals(VariableService.MASK, r.sent().headers().get("Authorization"), "sensitive headers are masked in the preview");
        assertTrue(r.sent().body().contains(name));
    }

    @Test
    void scriptsAreSandboxedAndTimeBoxed() {
        for (String bad : List.of("java.lang.System.exit(0)", "Packages.java.lang.System.getProperty('user.home')",
                "var x = new java.io.File('/'); x.list()", "this.constructor.constructor('return process')()")) {
            ApiRunResult r = service.run(scripted(bad, "{}", List.of()));
            assertFalse(r.success(), bad);
            assertTrue(r.error().startsWith("Pre-request script error"), r.error());
        }
        long t0 = System.currentTimeMillis();
        ApiRunResult loop = service.run(scripted("while (true) {}", "{}", List.of()));
        assertTrue(loop.error().contains("took longer"), loop.error());
        assertTrue(System.currentTimeMillis() - t0 < 8000);
        ApiRunResult syntax = service.run(scripted("var = ;", "{}", List.of()));
        assertTrue(syntax.error().startsWith("Pre-request script error"), syntax.error());
        assertFalse(service.run(scripted("vars.set('bad name', 1)", "{}", List.of())).success());
    }

    @Test
    void builtInsAcceptArgumentsAndShowAMaskedPreview() {
        variables.put("pw", "hunter2", true, "manual");
        ApiRunResult r = service.run(new ApiRequestDef(null, "b" + UUID.randomUUID(), null, "POST", base + "/echo", List.of(),
                "{\"a\":\"{{$randomString(6)}}\",\"n\":{{$randomInt(10,12)}},\"d\":\"{{$isoDate(+2)}}\",\"z\":\"{{$randomNumeric(4)}}\",\"p\":\"{{pw}}\"}",
                List.of(), null));
        assertTrue(r.success(), r.error());
        var tree = new com.fasterxml.jackson.databind.ObjectMapper();
        try {
            var sentJson = tree.readTree(r.body());
            assertEquals(6, sentJson.get("a").asText().length());
            assertTrue(sentJson.get("n").asInt() >= 10 && sentJson.get("n").asInt() <= 12);
            assertEquals(java.time.LocalDate.now().plusDays(2).toString(), sentJson.get("d").asText());
            assertEquals("hunter2", sentJson.get("p").asText(), "the real secret is sent");
            assertFalse(r.sent().body().contains("hunter2"), "but never shown");
            var shown = tree.readTree(r.sent().body());
            assertEquals(sentJson.get("a").asText(), shown.get("a").asText(), "the preview shows the same random values that were sent");
        } catch (Exception e) {
            fail(e);
        }
        assertThrows(ApiException.class, () -> variables.resolve("{{wallet(1)}}"));
    }
}
