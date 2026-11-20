package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderDtos.Folder;
import com.qa.utility.folder.FolderService;
import com.qa.utility.info.InfoDtos.InfoItem;
import com.qa.utility.info.InfoService;
import com.qa.utility.model.*;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.*;

class PlatformEnhancementsTest extends AbstractDbTest {
    @Autowired FolderService folders;
    @Autowired VariableService variables;
    @Autowired ApiAutomationService apiService;
    @Autowired ApiWorkflowService apiWorkflows;
    @Autowired ApiWorkflowRunner runner;
    @Autowired ApiReportService reports;
    @Autowired QueryLibraryService library;
    @Autowired InfoService info;
    @Autowired VariableSchemaMigration migration;
    @Autowired JdbcTemplate meta;

    HttpServer server;
    String base;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/wallets", ex -> {
            byte[] out = "{\"data\":{\"customerId\":\"HG870812\",\"displayAccountNumber\":\"HR1\"},\"result\":{\"responseCode\":\"0\"}}".getBytes(StandardCharsets.UTF_8);
            ex.sendResponseHeaders(201, out.length);
            ex.getResponseBody().write(out);
            ex.close();
        });
        server.setExecutor(Executors.newFixedThreadPool(4));
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
        variables.clear();
        variables.setActiveEnvironment("");
    }

    @AfterEach
    void stop() {
        server.stop(0);
        variables.clear();
        variables.setActiveEnvironment("");
    }

    private VariableBody body(String name, String value, String scope, Long folder, String env) {
        return new VariableBody(name, value, false, scope, folder, env);
    }

    private Folder folder(String kind, long parent, String name) {
        return folders.create(kind, parent, name + UUID.randomUUID().toString().substring(0, 6));
    }

    // ------------------------------------------------------------------ folders

    @Test
    void foldersNestRenameMoveAndNeverLoseItemsOnDelete() {
        Folder wallet = folder("REQUEST", 0, "Wallet");
        Folder sub = folder("REQUEST", wallet.id(), "Create");
        assertEquals(wallet.id(), sub.parentId());
        assertThrows(ApiException.class, () -> folders.create("REQUEST", wallet.id(), sub.name()), "duplicate name in the same parent");
        assertThrows(ApiException.class, () -> folders.create("REQUEST", 0L, "bad/name"));
        assertThrows(ApiException.class, () -> folders.create("VARIABLE", wallet.id(), "x"), "parent of another area");
        Folder renamed = folders.update(sub.id(), "Create Wallet " + UUID.randomUUID().toString().substring(0, 4), null);
        assertTrue(renamed.name().startsWith("Create Wallet"));
        assertThrows(ApiException.class, () -> folders.update(wallet.id(), null, sub.id()), "cannot move a folder into its own subfolder");
        assertThrows(ApiException.class, () -> folders.update(wallet.id(), null, wallet.id()));
        Folder savings = folder("REQUEST", 0, "Savings");
        assertEquals(savings.id(), folders.update(sub.id(), null, savings.id()).parentId(), "move under another folder");

        ApiRequestDef req = apiService.saveRequest(null, new ApiRequestDef(null, "r" + UUID.randomUUID(), null, "GET", base + "/wallets", List.of(), null, List.of(),
                null, null, sub.id()));
        assertEquals(sub.id(), apiService.requests().stream().filter(r -> r.id().equals(req.id())).findFirst().orElseThrow().folderId());
        apiService.moveRequest(req.id(), savings.id());
        folders.delete(savings.id());
        ApiRequestDef after = apiService.requests().stream().filter(r -> r.id().equals(req.id())).findFirst().orElseThrow();
        assertEquals(0L, after.folderId(), "deleting a folder moves its items to Unfiled instead of deleting them");
        assertThrows(ApiException.class, () -> folders.get(sub.id()), "subfolders are deleted with their parent");
        assertThrows(ApiException.class, () -> apiService.saveRequest(null, new ApiRequestDef(null, "z" + UUID.randomUUID(), null, "GET", base, List.of(), null,
                List.of(), null, null, 999_999L)), "unknown folder");
    }

    @Test
    void aFolderWithFolderScopedVariablesCannotBeDeleted() {
        Folder f = folder("VARIABLE", 0, "Wallet");
        variables.save(null, body("scoped", "1", "FOLDER", f.id(), null));
        assertThrows(ApiException.class, () -> folders.delete(f.id()));
        variables.list().stream().filter(v -> v.name().equals("scoped")).forEach(v -> variables.delete(v.id()));
        folders.delete(f.id());
    }

    // ------------------------------------------------------------------ variables

    @Test
    void variableScopesFollowTheDocumentedPrecedence() {
        Folder wallet = folder("VARIABLE", 0, "Wallet");
        Folder walletSub = folder("VARIABLE", wallet.id(), "Sub");
        variables.save(null, body("limit", "global", "GLOBAL", 0L, null));
        variables.save(null, body("limit", "qa", "ENVIRONMENT", 0L, "QA"));
        variables.save(null, body("limit", "staging", "ENVIRONMENT", 0L, "STAGING"));
        variables.save(null, body("limit", "folder", "FOLDER", wallet.id(), null));

        assertEquals("global", variables.resolve("{{limit}}"), "no environment, no folder: global");
        variables.setActiveEnvironment("QA");
        assertEquals("qa", variables.resolve("{{limit}}"));
        variables.setActiveEnvironment("Staging");
        assertEquals("staging", variables.resolve("{{limit}}"));

        VarScope run = new VarScope(false);
        run.setBaseFolders(folders.chain(walletSub.id()));
        assertEquals("folder", variables.resolve("{{limit}}", false, run), "a folder variable beats environment and global, also for subfolders");
        VarScope other = new VarScope(false);
        other.setBaseFolders(folders.chain(folder("VARIABLE", 0, "Other").id()));
        assertEquals("staging", variables.resolve("{{limit}}", false, other), "other folders do not see it");
        run.set("limit", "run", false);
        assertEquals("run", variables.resolve("{{limit}}", false, run), "run scope wins");

        assertThrows(ApiException.class, () -> variables.save(null, body("limit", "x", "GLOBAL", 0L, null)), "global names are unique");
        assertThrows(ApiException.class, () -> variables.save(null, body("f2", "x", "FOLDER", 0L, null)), "folder scope needs a folder");
        assertThrows(ApiException.class, () -> variables.save(null, body("e2", "x", "ENVIRONMENT", 0L, "PROD")));
        assertThrows(ApiException.class, () -> variables.setActiveEnvironment("PROD"));
    }

    @Test
    void secretsAreMaskedMovedAndKeptWhenEditedWithoutAValue() {
        Folder a = folder("VARIABLE", 0, "A");
        Folder b = folder("VARIABLE", 0, "B");
        VariableView v = variables.save(null, new VariableBody("pw", "hunter2", true, "GLOBAL", a.id(), null));
        assertEquals(VariableService.MASK, v.value());
        assertEquals(a.name(), v.folderPath());
        assertEquals("MANUAL", v.sourceType());
        assertEquals("hunter2", variables.resolve("{{pw}}"));
        variables.save(v.id(), new VariableBody(null, null, true, "GLOBAL", a.id(), null)); // edit without re-typing the secret
        assertEquals("hunter2", variables.resolve("{{pw}}"));
        variables.move(v.id(), b.id());
        assertEquals(b.name(), variables.list().stream().filter(x -> x.name().equals("pw")).findFirst().orElseThrow().folderPath());
        variables.save(v.id(), new VariableBody(null, "visible", false, "GLOBAL", b.id(), null));
        assertEquals("visible", variables.resolve("{{pw}}"));
        assertTrue(variables.list().stream().noneMatch(x -> "hunter2".equals(x.value())));
    }

    @Test
    void previewShowsResolvedAndMissingVariablesWithoutSending() {
        variables.put("acct", "20000000776", false, "api:x");
        variables.put("tok", "secretvalue", true, "api:x");
        ApiRequestDef def = new ApiRequestDef(null, "p" + UUID.randomUUID(), null, "POST", base + "/a/{{acct}}",
                List.of(new Header("Authorization", "Bearer {{tok}}"), new Header("X-Id", "{{missingVar}}")),
                "{\"a\":\"{{acct}}\",\"u\":\"{{$uuid}}\"}", List.of(), null);
        PreviewResult p = apiService.preview(def);
        assertFalse(p.ready());
        assertTrue(p.url().endsWith("/a/20000000776"));
        assertEquals(VariableService.MASK, p.headers().get("Authorization"));
        assertEquals("{{missingVar}}", p.headers().get("X-Id"));
        assertTrue(p.body().contains("\"20000000776\"") && p.body().contains("{{$uuid}}"));
        assertTrue(p.tokens().stream().anyMatch(t -> t.name().equals("missingVar") && !t.found()));
    }

    @Test
    void legacyVariableTablesAreUpgradedKeepingValues() {
        meta.execute("DROP TABLE api_variable");
        meta.execute("CREATE TABLE api_variable (name VARCHAR(100) PRIMARY KEY, value_text TEXT, secret BOOLEAN NOT NULL DEFAULT FALSE, source VARCHAR(200), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        meta.update("INSERT INTO api_variable (name, value_text, secret, source) VALUES ('old', 'v1', FALSE, 'api:x')");
        migration.migrate();
        assertEquals("v1", variables.resolve("{{old}}"));
        VariableView v = variables.list().stream().filter(x -> x.name().equals("old")).findFirst().orElseThrow();
        assertEquals("GLOBAL", v.scope());
        assertEquals("API", v.sourceType());
        migration.migrate(); // idempotent
        assertThrows(ApiException.class, () -> variables.save(null, body("old", "dup", "GLOBAL", 0L, null)), "same name + scope is unique after the upgrade");
    }

    // ------------------------------------------------------------------ API -> SQL -> variables

    private SavedQuery query(String name, String sql, QueryParameter p, QueryExtraction... ex) {
        return library.create(new SavedQuery(null, name + UUID.randomUUID(), "", "Test", sql, QueryType.READ, List.of(), true, null,
                p == null ? List.of() : List.of(p), List.of(ex)));
    }

    @Test
    void apiResponseFeedsSqlWhichFeedsVariablesAndAWorkflowChainsThemAll() throws Exception {
        Folder wallet = folder("VARIABLE", 0, "Wallet");
        Folder savings = folder("VARIABLE", 0, "Savings");
        ApiRequestDef create = apiService.saveRequest(null, new ApiRequestDef(null, "create" + UUID.randomUUID(), null, "POST", base + "/wallets", List.of(), "{}",
                List.of(new Extraction("displayAccountNumber", "BODY", "data.displayAccountNumber", false, wallet.id()),
                        new Extraction("customerId", "BODY", "data.customerId", false, wallet.id())), null));
        SavedQuery byAccount = query("getTheSavingsWalletDetailsID", "SELECT * FROM employee_transaction WHERE hr_id = ? ORDER BY id",
                new QueryParameter("hr_id", "Display account", ParamType.STRING, true, "{{displayAccountNumber}}"),
                new QueryExtraction("savingsWalletDetailsId", "id", false, savings.id()), new QueryExtraction("savingsAccountNumber", "hr_id", false, savings.id()));
        SavedQuery followUp = query("followUp", "SELECT * FROM employee_transaction WHERE id = ?",
                new QueryParameter("id", "Id", ParamType.INTEGER, true, "{{savingsWalletDetailsId}}"), new QueryExtraction("followHr", "hr_id", false, null));

        // 1) API response -> variables saved in the Wallet folder
        ApiRunResult r = apiService.run(create);
        assertTrue(r.success(), r.error());
        assertEquals("HR1", variables.resolve("{{displayAccountNumber}}"));
        VariableView saved = variables.list().stream().filter(v -> v.name().equals("displayAccountNumber")).findFirst().orElseThrow();
        assertEquals(wallet.name(), saved.folderPath());
        assertEquals("API", saved.sourceType());

        // 2) preview shows the mapped parameter before running; 3) SQL runs with the variable; 4) extraction saves new variables
        var preview = library.previewParams(byAccount.id(), Map.of());
        assertEquals("OK", preview.get(0).status());
        assertEquals("HR1", preview.get(0).resolved());
        QueryResult res = library.execute(byAccount.id(), Map.of(), null);
        assertTrue(res.rowCount() >= 1);
        assertEquals(2, res.extracted().size());
        assertEquals("HR1", variables.resolve("{{savingsAccountNumber}}"));
        VariableView sv = variables.list().stream().filter(v -> v.name().equals("savingsWalletDetailsId")).findFirst().orElseThrow();
        assertEquals(savings.name(), sv.folderPath());
        assertEquals("SQL", sv.sourceType());

        // 5) another query uses the SQL-extracted variable
        QueryResult res2 = library.execute(followUp.id(), Map.of(), null);
        assertEquals(1, res2.rowCount());
        assertEquals("HR1", variables.resolve("{{followHr}}"));

        // missing variable: clear error before anything runs
        variables.clear();
        ApiException e = assertThrows(ApiException.class, () -> library.execute(byAccount.id(), Map.of(), null));
        assertTrue(e.getMessage().contains("displayAccountNumber"), e.getMessage());
        assertEquals("MISSING_VARIABLE", library.previewParams(byAccount.id(), Map.of()).get(0).status());

        // 6) an API workflow chains API step -> SQL step -> SQL step, with isolated run variables
        ApiWorkflowDef wf = apiWorkflows.save(null, new ApiWorkflowDef(null, "chain" + UUID.randomUUID(), null, false, 120, List.of(
                new ApiWfStep(null, 1, "Create wallet", create.id(), create.name(), "POST", "STOP", true, ApiStepOptions.defaults()),
                new ApiWfStep(null, 2, "Find savings id", 0, null, null, "STOP", true, new ApiStepOptions(0, 1, 10, 3, List.of(), List.of()),
                        ApiWfStep.SQL, byAccount.id(), byAccount.name(), Map.of()),
                new ApiWfStep(null, 3, "Follow up", 0, null, null, "STOP", true, ApiStepOptions.defaults(), ApiWfStep.SQL, followUp.id(), followUp.name(), Map.of())),
                folder("API_WORKFLOW", 0, "Wallet").id()));
        ApiRunView run = await(runner.start(wf.id(), null));
        assertEquals("SUCCESS", run.status(), run.error() + " " + run.steps());
        assertEquals("SQL", run.steps().get(1).method());
        assertEquals("savingsWalletDetailsId", run.steps().get(1).extracted().get(0).variable());
        assertEquals("followHr", run.steps().get(2).extracted().get(0).variable());
        assertThrows(ApiException.class, () -> variables.resolve("{{savingsWalletDetailsId}}"), "publishGlobal=false keeps SQL variables private to the run");
    }

    @Test
    void sqlStepsPollUntilARowExistsAndFailClearlyOtherwise() throws Exception {
        SavedQuery none = query("nothing", "SELECT * FROM employee_transaction WHERE hr_id = ?", new QueryParameter("hr_id", "H", ParamType.STRING, true, "NOPE-{{$randomInt(1,1)}}"),
                new QueryExtraction("x", "id", false, null));
        ApiWorkflowDef wf = apiWorkflows.save(null, new ApiWorkflowDef(null, "poll" + UUID.randomUUID(), null, false, 120, List.of(
                new ApiWfStep(null, 1, "wait for row", 0, null, null, "STOP", true, new ApiStepOptions(0, 1, 30, 2, List.of(), List.of()),
                        ApiWfStep.SQL, none.id(), none.name(), Map.of()))));
        ApiRunView run = await(runner.start(wf.id(), null));
        assertEquals("FAILED", run.status());
        assertEquals(2, run.steps().get(0).attempts());
        assertTrue(run.steps().get(0).error().contains("no rows"), run.steps().get(0).error());

        SavedQuery missingVar = query("mv", "SELECT * FROM employee_transaction WHERE hr_id = ?", new QueryParameter("hr_id", "H", ParamType.STRING, true, "{{doesNotExist}}"));
        ApiWorkflowDef wf2 = apiWorkflows.save(null, new ApiWorkflowDef(null, "mv" + UUID.randomUUID(), null, false, 120, List.of(
                new ApiWfStep(null, 1, "needs var", 0, null, null, "STOP", true, ApiStepOptions.defaults(), ApiWfStep.SQL, missingVar.id(), missingVar.name(), Map.of()))));
        run = await(runner.start(wf2.id(), null));
        assertEquals("FAILED", run.status());
        assertEquals(1, run.steps().get(0).attempts(), "a missing variable is not retried");
        assertTrue(run.steps().get(0).error().contains("doesNotExist"));
    }

    // ------------------------------------------------------------------ history + info

    @Test
    void clearingRunHistoryKeepsRequestsWorkflowsAndVariables() throws Exception {
        ApiRequestDef req = apiService.saveRequest(null, new ApiRequestDef(null, "h" + UUID.randomUUID(), null, "POST", base + "/wallets", List.of(), "{}", List.of(), null));
        ApiWorkflowDef wf = apiWorkflows.save(null, new ApiWorkflowDef(null, "hist" + UUID.randomUUID(), null, true, 120, List.of(
                new ApiWfStep(null, 1, "s", req.id(), req.name(), "POST", "STOP", true, ApiStepOptions.defaults()))));
        variables.put("keepMe", "1", false, "manual");
        String a = runner.start(wf.id(), null);
        String b = runner.start(wf.id(), null);
        String c = runner.start(wf.id(), null);
        await(a);
        await(b);
        await(c);
        assertEquals(3, runner.history(wf.id(), 50).size());
        assertEquals(1, runner.deleteRuns(List.of(a)));
        assertEquals(2, runner.history(wf.id(), 50).size());
        assertEquals(2, runner.clearHistory(wf.id()));
        assertEquals(0, runner.history(wf.id(), 50).size());
        assertEquals(0, reports.report(wf.id(), 30).totalRuns());
        assertNotNull(apiWorkflows.get(wf.id()));
        assertEquals("1", variables.resolve("{{keepMe}}"));
        assertTrue(apiService.requests().stream().anyMatch(r -> r.id().equals(req.id())));
    }

    @Test
    void informationPagesLiveInFoldersAndAreSearchable() {
        Folder f = folder("INFO", 0, "Wallet");
        InfoItem it = info.save(null, new InfoItem(null, f.id(), "Wallet module", "Creates wallets. Table: bank_wallet.savings_wallet_details", null, null));
        assertEquals(f.id(), info.get(it.id()).folderId());
        assertTrue(info.list("savings_wallet").stream().anyMatch(s -> s.id().equals(it.id()) && s.snippet().contains("savings_wallet_details")));
        assertTrue(info.list("zzzz-nothing").isEmpty());
        info.save(it.id(), new InfoItem(null, f.id(), "Wallet module v2", "changed", null, null));
        assertEquals("Wallet module v2", info.get(it.id()).title());
        Folder g = folder("INFO", 0, "Savings");
        info.move(it.id(), g.id());
        assertEquals(g.id(), info.get(it.id()).folderId());
        folders.delete(g.id());
        assertEquals(0L, info.get(it.id()).folderId(), "the page survives its folder");
        info.delete(it.id());
        assertThrows(ApiException.class, () -> info.get(it.id()));
    }

    private ApiRunView await(String runId) throws Exception {
        long end = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < end) {
            ApiRunView v = runner.get(runId);
            if (!v.status().equals("QUEUED") && !v.status().equals("RUNNING")) return v;
            Thread.sleep(50);
        }
        fail("run did not finish");
        return null;
    }
}
