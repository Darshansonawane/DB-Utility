package com.qa.utility.connection;

import com.qa.utility.dto.ConnectionDtos.ConnectionRequest;
import com.qa.utility.dto.ConnectionDtos.ConnectionView;
import com.qa.utility.dto.ConnectionDtos.StatusView;
import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.WorkflowDtos.RunView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.repository.ConnectionProfileRepository;
import com.qa.utility.security.SessionContext;
import com.qa.utility.service.ConnectionService;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.service.SettingsService;
import com.qa.utility.workflow.WorkflowExecutor;
import com.qa.utility.workflow.WorkflowService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.automation.ApiWorkflowRunner;
import com.qa.utility.automation.ApiWorkflowService;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Talks to REAL servers (no mocks). Runs only when these are set, e.g. against throw-away local instances:
 * MONGO_TEST_PORT, MONGO_TEST_USER, MONGO_TEST_PASSWORD (database qa_customers, authSource admin) and
 * MYSQL_TEST_PORT, MYSQL_TEST_USER, MYSQL_TEST_PASSWORD (database bank_wallet with table customers(id, customer_id, name)).
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MONGO_TEST_PORT", matches = "\\d+")
@EnabledIfEnvironmentVariable(named = "MYSQL_TEST_PORT", matches = "\\d+")
class MultiDatabaseIntegrationTest {
    static final String MONGO_PORT = System.getenv("MONGO_TEST_PORT"), MONGO_USER = System.getenv("MONGO_TEST_USER"), MONGO_PW = System.getenv("MONGO_TEST_PASSWORD");
    static final String MYSQL_PORT = System.getenv("MYSQL_TEST_PORT"), MYSQL_USER = System.getenv("MYSQL_TEST_USER"), MYSQL_PW = System.getenv("MYSQL_TEST_PASSWORD");
    static final String ACCESS = "darshan-secret";

    @Autowired ConnectionService connections;
    @Autowired QueryLibraryService library;
    @Autowired ConnectionRegistry registry;
    @Autowired ConnectionProfileRepository profiles;
    @Autowired WorkflowService workflows;
    @Autowired WorkflowExecutor executor;
    @Autowired SettingsService settings;
    @Autowired ApiWorkflowService apiWorkflows;
    @Autowired ApiWorkflowRunner apiRunner;

    final String u = UUID.randomUUID().toString().substring(0, 8);

    @AfterEach
    void cleanup() {
        SessionContext.clear();
        settings.update(AppSettings.defaults());
    }

    static <T> T as(String sid, Supplier<T> s) {
        String prev = SessionContext.current();
        SessionContext.set(sid);
        try {
            return s.get();
        } finally {
            SessionContext.set(prev);
        }
    }

    static final String LIMITED_PW = "Lim-Test-Pw-1", NODB_PW = "Nodb-Test-Pw-1", NOROLE_PW = "Nor-Test-Pw-1";

    ConnectionView mysqlAs(String name, String user, String pw) {
        return connections.create(new ConnectionRequest(name + u, "QA", "MYSQL", "127.0.0.1", Integer.parseInt(MYSQL_PORT), null, user, pw, false, null, null, false, "Darshan", ACCESS, null));
    }

    ConnectionView mongoAs(String name, String user, String pw) {
        return connections.create(new ConnectionRequest(name + u, "QA", "MONGODB", "127.0.0.1", Integer.parseInt(MONGO_PORT), null, user, pw, false, null, "admin", false, "Darshan", ACCESS, null));
    }

    ConnectionView mysql(String name) {
        return connections.create(new ConnectionRequest(name + u, "QA", "MYSQL", "127.0.0.1", Integer.parseInt(MYSQL_PORT), "bank_wallet", MYSQL_USER, MYSQL_PW,
                false, null, null, false, "Darshan", ACCESS, null));
    }

    ConnectionView mongoHost(String name, String env, String dbPassword) {
        return connections.create(new ConnectionRequest(name + u, env, "MONGODB", "127.0.0.1", Integer.parseInt(MONGO_PORT), "qa_customers", MONGO_USER, dbPassword,
                false, null, "admin", false, "Darshan", ACCESS, null));
    }

    ConnectionView mongoUri(String name, String env) {
        String uri = "mongodb://" + MONGO_USER + ":" + MONGO_PW + "@127.0.0.1:" + MONGO_PORT + "/qa_customers?authSource=admin";
        return connections.create(new ConnectionRequest(name + u, env, "MONGODB", null, 0, null, null, null, true, uri, null, false, "Darshan", ACCESS, null));
    }

    SavedQuery mongoQuery(String name, String spec, QueryParameter... params) {
        return library.create(new SavedQuery(null, name + u, null, "it", spec, QueryType.READ, List.of(), true, null, List.of(params), List.of(), DbType.MONGODB));
    }

    static QueryParameter p(String n, ParamType t) {
        return new QueryParameter(n, n, t, true, null);
    }

    // ------------------------------------------------------------------ connectivity

    @Test
    void mysqlAndMongoStayConnectedTogetherAndEachOneWorks() {
        SessionContext.set("darshan-" + u);
        ConnectionView my = mysql("wallet-mysql-"), mHost = mongoHost("customers-host-", "STAGING", MONGO_PW), mUri = mongoUri("customers-uri-", "DEV");
        assertEquals("DEV", mUri.environment());
        assertTrue(connections.testSaved(my.id(), ACCESS).serverVersion().startsWith("MySQL"));
        assertTrue(connections.testSaved(mHost.id(), ACCESS).serverVersion().startsWith("MongoDB"));
        assertTrue(connections.testSaved(mUri.id(), ACCESS).success());

        connections.connect(my.id(), ACCESS);
        connections.connect(mHost.id(), ACCESS);
        connections.connect(mUri.id(), ACCESS);
        List<StatusView> live = connections.statuses();
        assertEquals(3, live.size());
        assertTrue(live.stream().allMatch(StatusView::connected));
        assertEquals(2, live.stream().filter(s -> s.dbType().equals("MONGODB")).count());
        assertEquals(my.id(), connections.status().profileId(), "header status follows the active MySQL connection");

        SavedQuery sql = library.create(new SavedQuery(null, "sql-cust-" + u, null, "it", "SELECT name FROM customers WHERE customer_id = ?", QueryType.READ,
                List.of(), true, List.of(p("customer_id", ParamType.STRING))));
        assertEquals("Asha", library.execute(sql.id(), Map.of("customer_id", "C100"), null).rows().get(0).get(0));
        SavedQuery find = mongoQuery("mongo-cust-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"},\"projection\":{\"_id\":0,\"name\":1}}", p("customerId", ParamType.STRING));
        assertEquals("Asha", library.execute(find.id(), Map.of("customerId", "C100"), null).rows().get(0).get(0));

        connections.activate(mHost.id());
        assertTrue(registry.isActive(mHost.id()) && !registry.isActive(mUri.id()));
        assertEquals(3, connections.statuses().size(), "switching never disconnects the others");

        connections.disconnect(my.id());
        assertEquals(2, connections.statuses().size());
        assertEquals("Asha", library.execute(find.id(), Map.of("customerId", "C100"), null).rows().get(0).get(0), "MongoDB unaffected by closing MySQL");
        assertEquals(409, assertThrows(ApiException.class, () -> library.execute(sql.id(), Map.of("customer_id", "C100"), null)).status().value());
    }

    @Test
    void eachBrowserSessionOnlySeesItsOwnLiveConnectionsAndNeedsTheAccessPassword() {
        ConnectionView mine = as("darshan-" + u, () -> mongoUri("private-mongo-", "QA"));
        as("darshan-" + u, () -> connections.connect(mine.id(), ACCESS));
        SavedQuery q = as("darshan-" + u, () -> mongoQuery("private-q-", "{\"collection\":\"customers\"}"));
        assertEquals(2, as("darshan-" + u, () -> library.execute(q.id(), Map.of(), null)).rowCount());

        // Rahul can see the connection exists but can neither use it nor guess his way in
        as("rahul-" + u, () -> {
            assertTrue(connections.list().stream().anyMatch(c -> c.id().equals(mine.id()) && !c.connected()));
            assertEquals(0, connections.statuses().size());
            assertEquals(409, assertThrows(ApiException.class, () -> library.execute(q.id(), Map.of(), null)).status().value(), "no live MongoDB for Rahul");
            assertEquals(403, assertThrows(ApiException.class, () -> connections.connect(mine.id(), "wrong-password")).status().value());
            assertThrows(ApiException.class, () -> connections.testSaved(mine.id(), null));
            assertThrows(ApiException.class, () -> connections.delete(mine.id(), "wrong-password"));
            return null;
        });
        // Darshan's connection kept working through all of that
        assertEquals(2, as("darshan-" + u, () -> library.execute(q.id(), Map.of(), null)).rowCount());
        // Rahul with the right password gets his own, separate live connection
        as("rahul-" + u, () -> {
            connections.connect(mine.id(), ACCESS);
            assertEquals(2, library.execute(q.id(), Map.of(), null).rowCount());
            connections.disconnect(mine.id());
            return null;
        });
        assertEquals(1, as("darshan-" + u, () -> connections.statuses()).size(), "Rahul disconnecting did not touch Darshan's");
    }

    @Test
    void aBadCredentialConnectionFailsAloneAndLeaksNothing() {
        SessionContext.set("s-" + u);
        ConnectionView good = mongoUri("good-", "QA");
        ConnectionView bad = mongoHost("bad-", "QA", "not-the-password");
        connections.connect(good.id(), ACCESS);
        ApiException e = assertThrows(ApiException.class, () -> connections.connect(bad.id(), ACCESS));
        assertTrue(e.getMessage().startsWith("Could not connect"));
        assertFalse(e.getMessage().contains("not-the-password"));
        assertFalse(connections.testSaved(bad.id(), ACCESS).success());
        assertTrue(connections.statuses().stream().allMatch(StatusView::connected));
        assertEquals(1, connections.statuses().size());
    }

    @Test
    void editingOrDeletingOneConnectionLeavesTheOthersConnected() {
        SessionContext.set("s-" + u);
        ConnectionView a = mongoUri("edit-a-", "QA"), b = mongoUri("edit-b-", "STAGING"), c = mysql("edit-c-");
        for (ConnectionView v : List.of(a, b, c)) connections.connect(v.id(), ACCESS);
        assertThrows(ApiException.class, () -> connections.update(a.id(), new ConnectionRequest("hijack" + u, "QA", "MONGODB", null, 0, null, null, null, true, null, null, false, null, "nope-nope", null)));
        assertEquals(3, connections.statuses().size(), "a refused edit changes nothing");
        connections.update(a.id(), new ConnectionRequest("edit-a-renamed" + u, "QA", "MONGODB", null, 0, null, null, null, true, null, null, false, null, ACCESS, null));
        assertEquals(2, connections.statuses().size(), "only the edited connection was closed");
        connections.delete(b.id(), ACCESS);
        assertEquals(1, connections.statuses().size());
        assertEquals("Asha", library.execute(library.create(new SavedQuery(null, "after-" + u, null, "it", "SELECT name FROM customers WHERE customer_id = ?", QueryType.READ,
                List.of(), true, List.of(p("customer_id", ParamType.STRING)))).id(), Map.of("customer_id", "C100"), null).rows().get(0).get(0));
    }

    @Test
    void storedSecretsAreEncryptedAndNothingSecretIsInTheApiView() {
        SessionContext.set("s-" + u);
        ConnectionView v = mongoHost("enc-", "QA", MONGO_PW);
        ConnectionView w = mongoUri("enc-uri-", "QA");
        ConnectionProfile hostRow = profiles.findById(v.id()).get(), uriRow = profiles.findById(w.id()).get();
        assertTrue(hostRow.passwordEncrypted().startsWith("v2:"));
        assertTrue(uriRow.uriEncrypted().startsWith("v2:"));
        for (String secret : List.of(MONGO_PW, ACCESS)) {
            assertFalse(hostRow.toString().replace(hostRow.passwordEncrypted(), "").contains(secret));
            assertFalse(uriRow.uriEncrypted().contains(secret));
            assertFalse(v.toString().contains(secret) || w.toString().contains(secret));
        }
        assertTrue(w.usesUri());
    }

    // ------------------------------------------------------------------ MongoDB querying

    @Test
    void mongoQueriesBindTypedParametersAndRenderEveryBsonType() {
        SessionContext.set("s-" + u);
        connections.connect(mongoUri("q-", "QA").id(), ACCESS);

        QueryResult all = library.execute(mongoQuery("all-", "{\"collection\":\"customers\",\"sort\":{\"customerId\":1}}").id(), Map.of(), null);
        assertEquals(2, all.rowCount());
        List<String> cols = all.columns().stream().map(c -> c.name()).toList();
        Map<String, Object> asha = all.firstRow();
        assertTrue(cols.contains("_id") && ((String) asha.get("_id")).matches("[0-9a-f]{24}"), "ObjectId as hex");
        assertEquals("120.50", asha.get("balance"), "Decimal128 keeps its exact value");
        assertEquals("2024-03-01T00:00:00Z", asha.get("joined"));
        assertEquals("[\"gold\", \"wallet\"]", asha.get("tags"));
        assertEquals("{\"city\": \"Pune\"}", asha.get("address"));

        assertEquals("C200", library.execute(mongoQuery("date-", "{\"collection\":\"customers\",\"filter\":{\"joined\":{\"$gte\":\"?\"}}}", p("joined", ParamType.DATE)).id(),
                Map.of("joined", "2024-04-01"), null).firstRow().get("customerId"));
        assertEquals("C100", library.execute(mongoQuery("dec-", "{\"collection\":\"customers\",\"filter\":{\"balance\":{\"$gt\":\"?\"}}}", p("min", ParamType.DECIMAL)).id(),
                Map.of("min", "100"), null).firstRow().get("customerId"));
        assertEquals(1, library.execute(mongoQuery("int-", "{\"collection\":\"accounts\",\"filter\":{\"amount\":{\"$lt\":\"?\"}}}", p("amount", ParamType.INTEGER)).id(),
                Map.of("amount", "10"), null).rowCount());

        QueryResult count = library.execute(mongoQuery("count-", "{\"collection\":\"accounts\",\"operation\":\"count\",\"filter\":{\"clientUniqueId\":\"?\"}}", p("clientUniqueId", ParamType.STRING)).id(),
                Map.of("clientUniqueId", "CU-1"), null);
        assertEquals(2L, count.firstRow().get("count"));

        QueryResult agg = library.execute(mongoQuery("agg-", "{\"collection\":\"accounts\",\"operation\":\"aggregate\",\"pipeline\":[{\"$match\":{\"clientUniqueId\":\"?\"}},{\"$group\":{\"_id\":\"$kind\",\"total\":{\"$sum\":\"$amount\"}}},{\"$sort\":{\"_id\":1}}]}", p("clientUniqueId", ParamType.STRING)).id(),
                Map.of("clientUniqueId", "CU-1"), null);
        assertEquals(List.of("SAVINGS", 500), List.of(agg.rows().get(0).get(0), agg.rows().get(0).get(1)));
        assertEquals(List.of("WALLET", 75), List.of(agg.rows().get(1).get(0), agg.rows().get(1).get(1)));

        QueryResult distinct = library.execute(mongoQuery("distinct-", "{\"collection\":\"accounts\",\"operation\":\"distinct\",\"field\":\"kind\"}").id(), Map.of(), null);
        assertEquals(List.of("SAVINGS", "WALLET"), distinct.rows().stream().map(r -> r.get(0)).toList());

        assertEquals(0, library.execute(mongoQuery("none-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"}}", p("customerId", ParamType.STRING)).id(),
                Map.of("customerId", "NOPE"), null).rowCount());
    }

    @Test
    void mongoResultLimitTruncatesAndWritesOrServerCodeAreRefused() {
        SessionContext.set("s-" + u);
        connections.connect(mongoUri("lim-", "QA").id(), ACCESS);
        settings.update(new AppSettings(true, 10, 30, 10, false, true));
        QueryResult r = library.execute(mongoQuery("bulk-", "{\"collection\":\"bulk\",\"sort\":{\"n\":1}}").id(), Map.of(), null);
        assertEquals(10, r.rowCount());
        assertTrue(r.truncated());

        for (String bad : List.of("{\"collection\":\"customers\",\"filter\":{\"$where\":\"sleep(5000)\"}}",
                "{\"collection\":\"customers\",\"operation\":\"aggregate\",\"pipeline\":[{\"$out\":\"stolen\"}]}",
                "{\"collection\":\"customers\",\"operation\":\"aggregate\",\"pipeline\":[{\"$match\":{}},{\"$merge\":{\"into\":\"x\"}}]}",
                "{\"collection\":\"customers\",\"operation\":\"insert\"}", "{\"collection\":\"customers\",\"operation\":\"delete\",\"filter\":{}}",
                "{\"collection\":\"system.users\"}", "{\"collection\":\"customers\",\"filter\":{\"$expr\":{\"$function\":{\"body\":\"function(){}\",\"args\":[],\"lang\":\"js\"}}}}",
                "{not json", "{\"collection\":\"customers\",\"surprise\":1}")) {
            assertThrows(ApiException.class, () -> mongoQuery("bad-", bad), bad);
        }
        assertThrows(ApiException.class, () -> mongoQuery("params-", "{\"collection\":\"customers\",\"filter\":{\"a\":\"?\",\"b\":\"?\"}}", p("a", ParamType.STRING)),
                "one parameter definition per placeholder");
        // and the data is still all there
        assertEquals(2, library.execute(mongoQuery("still-", "{\"collection\":\"customers\"}").id(), Map.of(), null).rowCount());
    }

    // ------------------------------------------------------------------ workflows

    @Test
    void aWorkflowChainsMySqlAndMongoStepsPassingValuesBetweenThem() {
        SessionContext.set("s-" + u);
        connections.connect(mysql("wf-my-").id(), ACCESS);
        connections.connect(mongoUri("wf-mongo-", "QA").id(), ACCESS);
        SavedQuery s1 = library.create(new SavedQuery(null, "wf-sql-" + u, null, "it", "SELECT customer_id, name FROM customers WHERE customer_id = ?", QueryType.READ,
                List.of(), true, List.of(p("customer_id", ParamType.STRING))));
        SavedQuery s2 = mongoQuery("wf-find-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"}}", p("customerId", ParamType.STRING));
        SavedQuery s3 = mongoQuery("wf-accts-", "{\"collection\":\"accounts\",\"filter\":{\"clientUniqueId\":\"?\"},\"sort\":{\"accountNo\":1}}", p("clientUniqueId", ParamType.STRING));
        Workflow w = workflows.create(new Workflow(null, "mixed-" + u, null, List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true)), List.of(
                new WorkflowStep(null, 1, "MySQL customer", null, s1.id(), null, List.of(), 0, 100, false, List.of(new OutputField("cust", "customer_id")),
                        List.of(new ParamMapping("customer_id", SourceType.INPUT, "customerId", null, null))),
                new WorkflowStep(null, 2, "Mongo customer", null, s2.id(), null, List.of(1), 0, 100, false, List.of(new OutputField("client", "clientUniqueId")),
                        List.of(new ParamMapping("customerId", SourceType.STEP_OUTPUT, "1", "cust", null))),
                new WorkflowStep(null, 3, "Mongo accounts", null, s3.id(), null, List.of(2), 0, 100, false, List.of(),
                        List.of(new ParamMapping("clientUniqueId", SourceType.STEP_OUTPUT, "2", "client", null))))));
        RunView run = executor.runNow(w.id(), Map.of("customerId", "C100"), Map.of(), List.of());
        assertEquals("SUCCESS", run.status(), run.steps().toString());
        assertEquals("CU-1", run.steps().get(1).outputs().get("client"));
        assertEquals(2, run.steps().get(2).result().rowCount(), "both of CU-1's accounts");
    }

    @Test
    void workflowRunsStayWithTheirBrowserSessionAndKeepItsConnectionsWhenAsync() throws Exception {
        SessionContext.set("owner-" + u);
        connections.connect(mongoUri("async-", "QA").id(), ACCESS);
        SavedQuery q = mongoQuery("async-q-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"}}", p("customerId", ParamType.STRING));
        Workflow w = workflows.create(new Workflow(null, "async-" + u, null, List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true)), List.of(
                new WorkflowStep(null, 1, "find", null, q.id(), null, List.of(), 0, 100, false, List.of(),
                        List.of(new ParamMapping("customerId", SourceType.INPUT, "customerId", null, null))))));
        RunView started = executor.start(w.id(), Map.of("customerId", "C200"), Map.of(), List.of());
        RunView done = started;
        for (int i = 0; i < 100 && !done.status().equals("SUCCESS") && !done.status().equals("FAILED"); i++) {
            Thread.sleep(100);
            done = executor.get(started.runId());
        }
        assertEquals("SUCCESS", done.status(), "the background thread ran on the starting session's connection");
        as("intruder-" + u, () -> assertThrows(ApiException.class, () -> executor.get(started.runId())));
    }

    // ------------------------------------------------------------------ database discovery and switching

    @Test
    void mysqlNeedsNoDatabaseDiscoversWhatTheUserMayAccessAndSwitchesWithoutReconnecting() {
        SessionContext.set("s-" + u);
        ConnectionView c = mysqlAs("nodb-mysql-", MYSQL_USER, MYSQL_PW);
        assertNull(c.databaseName(), "created without a database name");
        connections.connect(c.id(), ACCESS);
        assertNull(connections.status().databaseName());

        var list = connections.databases(DbType.MYSQL);
        assertTrue(list.databases().containsAll(List.of("bank_wallet", "bank_audit", "bank_other")));
        assertFalse(list.databases().contains("prod_ledger"), "production-looking names are hidden even though the user can access them");
        assertFalse(list.databases().stream().anyMatch(n -> n.equals("mysql") || n.equals("information_schema")));
        assertNull(list.selected());

        SavedQuery unqualified = library.create(new SavedQuery(null, "unq-" + u, null, "it", "SELECT name FROM customers WHERE customer_id = ?", QueryType.READ,
                List.of(), true, List.of(p("customer_id", ParamType.STRING))));
        ApiException none = assertThrows(ApiException.class, () -> library.execute(unqualified.id(), Map.of("customer_id", "C100"), null));
        assertTrue(none.getMessage().startsWith("No database selected"), none.getMessage());
        SavedQuery qualified = library.create(new SavedQuery(null, "qual-" + u, null, "it", "SELECT name FROM bank_wallet.customers WHERE customer_id = ?", QueryType.READ,
                List.of(), true, List.of(p("customer_id", ParamType.STRING))));
        assertEquals("Asha", library.execute(qualified.id(), Map.of("customer_id", "C100"), null).rows().get(0).get(0));

        assertEquals("bank_wallet", connections.useDatabase("bank_wallet", DbType.MYSQL).databaseName());
        assertEquals("Asha", library.execute(unqualified.id(), Map.of("customer_id", "C100"), null).rows().get(0).get(0));
        SavedQuery audit = library.create(new SavedQuery(null, "audit-" + u, null, "it", "SELECT what FROM events WHERE id = ?", QueryType.READ,
                List.of(), true, List.of(p("id", ParamType.INTEGER))));
        connections.useDatabase("bank_audit", DbType.MYSQL);
        assertEquals("login", library.execute(audit.id(), Map.of("id", "1"), null).rows().get(0).get(0), "switched on the same connection, no reconnect");
        assertEquals(1, connections.statuses().size());
        assertEquals("bank_audit", connections.status().databaseName());

        assertEquals(400, assertThrows(ApiException.class, () -> connections.useDatabase("bank_missing", DbType.MYSQL)).status().value());
        assertEquals(400, assertThrows(ApiException.class, () -> connections.useDatabase("prod_ledger", DbType.MYSQL)).status().value(), "blocked name, though the user has access");
        assertEquals("bank_audit", connections.status().databaseName(), "a refused switch changes nothing");
    }

    @Test
    void mongoNeedsNoDatabaseDiscoversAuthorizedOnesAndSwitchesIndependently() {
        SessionContext.set("s-" + u);
        ConnectionView my = mysql("mix-my-"), mongo = mongoAs("nodb-mongo-", MONGO_USER, MONGO_PW);
        assertNull(mongo.databaseName());
        connections.connect(my.id(), ACCESS);
        connections.connect(mongo.id(), ACCESS);

        var list = connections.databases(DbType.MONGODB);
        assertEquals(List.of("qa_customers", "qa_other"), list.databases(), "only databases this user holds privileges on; system databases hidden");
        assertFalse(list.restricted());
        assertNull(list.selected());

        SavedQuery customers = mongoQuery("nd-cust-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"},\"projection\":{\"_id\":0,\"name\":1}}", p("customerId", ParamType.STRING));
        ApiException none = assertThrows(ApiException.class, () -> library.execute(customers.id(), Map.of("customerId", "C100"), null));
        assertTrue(none.getMessage().startsWith("No database selected"), none.getMessage());
        assertEquals(List.of("accounts", "bulk", "customers"), connections.useDatabase("qa_customers", DbType.MONGODB) != null ? mongoCollections() : List.of());
        assertEquals("Asha", library.execute(customers.id(), Map.of("customerId", "C100"), null).rows().get(0).get(0));

        SavedQuery parts = mongoQuery("nd-parts-", "{\"collection\":\"parts\",\"projection\":{\"_id\":0}}");
        connections.useDatabase("qa_other", DbType.MONGODB);
        assertEquals(1, library.execute(parts.id(), Map.of(), null).rowCount());

        connections.useDatabase("bank_wallet", DbType.MYSQL);
        assertEquals("qa_other", connections.statuses().stream().filter(s -> s.dbType().equals("MONGODB")).findFirst().get().databaseName(), "switching MySQL does not move MongoDB");
        assertEquals("bank_wallet", connections.status().databaseName());
        assertEquals(400, assertThrows(ApiException.class, () -> connections.useDatabase("qa_secret", DbType.MONGODB)).status().value());
        assertEquals(2, connections.statuses().size(), "no connection was dropped by any of this");
    }

    @Autowired com.qa.utility.service.MongoExecutionService mongoExec;

    List<String> mongoCollections() {
        return mongoExec.collections(null);
    }

    @Test
    void discoveryRespectsTheDatabaseUsersPermissions() {
        org.junit.jupiter.api.Assumptions.assumeTrue(System.getenv("MONGO_TEST_LIMITED_USER") != null);
        SessionContext.set("s-" + u);
        ConnectionView my = mysqlAs("lim-my-", "limited", LIMITED_PW), nodb = mysqlAs("nodb-my-", "nodb", NODB_PW);
        ConnectionView mg = mongoAs("lim-mongo-", "qa_limited", LIMITED_PW), norole = mongoAs("norole-mongo-", "qa_norole", NOROLE_PW);
        for (ConnectionView v : List.of(my, nodb, mg, norole)) connections.connect(v.id(), ACCESS);

        connections.activate(my.id());
        assertEquals(List.of("bank_wallet"), connections.databases(DbType.MYSQL).databases());
        assertEquals(400, assertThrows(ApiException.class, () -> connections.useDatabase("bank_audit", DbType.MYSQL)).status().value());

        connections.activate(nodb.id());
        var empty = connections.databases(DbType.MYSQL);
        assertTrue(empty.databases().isEmpty() && empty.message() != null, "no accessible databases: explained, not an error");

        connections.activate(mg.id());
        assertEquals(List.of("qa_customers"), connections.databases(DbType.MONGODB).databases());
        assertEquals(400, assertThrows(ApiException.class, () -> connections.useDatabase("qa_other", DbType.MONGODB)).status().value());
        connections.useDatabase("qa_customers", DbType.MONGODB);
        // the server enforces the permission regardless of what the UI offers: the read-only user cannot see another database
        connections.activate(norole.id());
        assertTrue(connections.databases(DbType.MONGODB).databases().isEmpty());
        assertEquals(4, connections.statuses().size());
    }

    // ------------------------------------------------------------------ workflow writes against the real MySQL

    /** Direct, independent JDBC connection as the full-privilege test user: used to create fixtures and to check what really changed. */
    Connection direct() throws Exception {
        return DriverManager.getConnection("jdbc:mysql://127.0.0.1:" + MYSQL_PORT + "/bank_wallet", MYSQL_USER, MYSQL_PW);
    }

    String table;

    void fixture() throws Exception {
        table = "wf_schedule_" + u;
        try (Connection c = direct(); Statement st = c.createStatement()) {
            st.execute("CREATE TABLE bank_wallet." + table + " (id INT PRIMARY KEY, customer_id VARCHAR(20), scheduled_date DATE, status VARCHAR(20))");
            st.execute("INSERT INTO bank_wallet." + table + " VALUES (1,'C100','2027-02-01','OPEN'),(2,'C100','2027-01-01','OPEN'),(3,'C100','2026-12-01','OPEN'),(4,'C999','2027-02-01','OPEN')");
        }
    }

    void dropFixture() throws Exception {
        try (Connection c = direct(); Statement st = c.createStatement()) {
            st.execute("DROP TABLE IF EXISTS bank_wallet." + table);
        }
    }

    String scalar(String sql) throws Exception {
        try (Connection c = direct(); Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            return rs.next() ? rs.getString(1) : null;
        }
    }

    SavedQuery sqlQuery(String name, QueryType type, String sql, QueryParameter... params) {
        return library.create(new SavedQuery(null, name + u, null, "it", sql, type, List.of(), true, List.of(params)));
    }

    WorkflowStep step(int order, String name, SavedQuery q, List<Integer> deps, List<OutputField> outs, ParamMapping... maps) {
        return new WorkflowStep(null, order, name, null, q.id(), null, deps, 0, 0, false, outs, List.of(maps));
    }

    @Test
    void workflowUpdateInsertAndDeleteReallyChangeTheMySqlDatabase() throws Exception {
        fixture();
        try {
            SessionContext.set("s-" + u);
            ConnectionView c = mysqlAs("wf-write-", MYSQL_USER, MYSQL_PW);
            connections.connect(c.id(), ACCESS);
            connections.useDatabase("bank_wallet", DbType.MYSQL);
            assertTrue(settings.get().readOnlyMode(), "the global read-only switch is ON and must not matter to workflows");

            SavedQuery fetch = sqlQuery("fetch-", QueryType.READ, "SELECT id FROM " + table + " WHERE customer_id = ? ORDER BY id DESC", p("customer_id", ParamType.STRING));
            SavedQuery update = sqlQuery("upd-", QueryType.WRITE, "UPDATE " + table + " SET scheduled_date = ?, status = ? WHERE id = ?",
                    p("d", ParamType.DATE), p("status", ParamType.STRING), p("id", ParamType.INTEGER));
            SavedQuery insert = sqlQuery("ins-", QueryType.WRITE, "INSERT INTO " + table + " (id, customer_id, scheduled_date, status) VALUES (?, ?, ?, ?)",
                    p("id", ParamType.INTEGER), p("customer", ParamType.STRING), p("d", ParamType.DATE), p("status", ParamType.STRING));
            SavedQuery delete = sqlQuery("del-", QueryType.WRITE, "DELETE FROM " + table + " WHERE customer_id = ? AND status = ?", p("customer", ParamType.STRING), p("status", ParamType.STRING));
            SavedQuery verify = sqlQuery("verify-", QueryType.READ, "SELECT status FROM " + table + " WHERE id = ?", p("id", ParamType.INTEGER));

            Workflow w = workflows.create(new Workflow(null, "real-writes-" + u, null, List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true)), List.of(
                    step(1, "fetch schedule", fetch, List.of(), List.of(new OutputField("latestId", "id")), new ParamMapping("customer_id", SourceType.INPUT, "customerId", null, null)),
                    step(2, "update the schedule date", update, List.of(1), List.of(), new ParamMapping("d", SourceType.CONSTANT, null, null, "2026-11-01"),
                            new ParamMapping("status", SourceType.CONSTANT, null, null, "RESTORED"), new ParamMapping("id", SourceType.STEP_OUTPUT, "1", "latestId", null)),
                    step(3, "insert a temporary row", insert, List.of(2), List.of(), new ParamMapping("id", SourceType.CONSTANT, null, null, "50"),
                            new ParamMapping("customer", SourceType.INPUT, "customerId", null, null), new ParamMapping("d", SourceType.CONSTANT, null, null, "2030-01-01"),
                            new ParamMapping("status", SourceType.CONSTANT, null, null, "TEMP")),
                    step(4, "read back what step 2 wrote", verify, List.of(2), List.of(new OutputField("status", "status")), new ParamMapping("id", SourceType.STEP_OUTPUT, "1", "latestId", null)),
                    step(5, "delete the temporary row", delete, List.of(3), List.of(), new ParamMapping("customer", SourceType.INPUT, "customerId", null, null),
                            new ParamMapping("status", SourceType.CONSTANT, null, null, "TEMP")))));

            RunView run = executor.runNow(w.id(), Map.of("customerId", "C100"), Map.of(), List.of());

            assertEquals("SUCCESS", run.status(), run.steps().toString());
            assertEquals("3", run.steps().get(1).params().get("id"), "step 2 received the id captured by step 1 (newest row)");
            assertEquals(1, run.steps().get(1).rowsAffected());
            assertEquals(1, run.steps().get(2).rowsAffected());
            assertEquals("RESTORED", run.steps().get(3).outputs().get("status"), "step 4 read the value step 2 wrote, in the same run");
            assertEquals(1, run.steps().get(4).rowsAffected());
            // what really happened in MySQL, seen through a separate connection (so it is committed, not pending)
            assertEquals("2026-11-01", scalar("SELECT scheduled_date FROM " + table + " WHERE id = 3"));
            assertEquals("RESTORED", scalar("SELECT status FROM " + table + " WHERE id = 3"));
            assertNull(scalar("SELECT id FROM " + table + " WHERE id = 50"), "inserted by step 3, deleted by step 5");
            assertEquals("3", scalar("SELECT COUNT(*) FROM " + table + " WHERE status = 'OPEN'"), "rows 1, 2 and 4 untouched");
            assertEquals(3, ((Number) meta().queryForMap("SELECT rows_affected FROM workflow_run WHERE id = ?", run.runId()).get("ROWS_AFFECTED")).intValue(), "update + insert + delete are counted in the run history");
        } finally {
            dropFixture();
        }
    }

    @Autowired org.springframework.jdbc.core.JdbcTemplate metaDb;

    org.springframework.jdbc.core.JdbcTemplate meta() {
        return metaDb;
    }

    @Test
    void whenTheDatabaseUserLacksPrivilegesTheDatabaseRejectsTheWriteAndItsOwnErrorIsShown() throws Exception {
        fixture();
        try {
            SessionContext.set("s-" + u);
            ConnectionView c = mysqlAs("wf-limited-", "limited", LIMITED_PW); // this MySQL account has SELECT only
            connections.connect(c.id(), ACCESS);
            connections.useDatabase("bank_wallet", DbType.MYSQL);

            SavedQuery update = sqlQuery("lupd-", QueryType.WRITE, "UPDATE " + table + " SET status = ? WHERE id = ?", p("status", ParamType.STRING), p("id", ParamType.INTEGER));
            SavedQuery insert = sqlQuery("lins-", QueryType.WRITE, "INSERT INTO " + table + " (id, customer_id, scheduled_date, status) VALUES (?, ?, ?, ?)",
                    p("id", ParamType.INTEGER), p("customer", ParamType.STRING), p("d", ParamType.DATE), p("status", ParamType.STRING));
            SavedQuery delete = sqlQuery("ldel-", QueryType.WRITE, "DELETE FROM " + table + " WHERE id = ?", p("id", ParamType.INTEGER));
            SavedQuery select = sqlQuery("lsel-", QueryType.READ, "SELECT COUNT(*) AS n FROM " + table, new QueryParameter[0]);
            Workflow w = workflows.create(new Workflow(null, "denied-" + u, null, List.of(), List.of(
                    step(1, "update", update, List.of(), List.of(), new ParamMapping("status", SourceType.CONSTANT, null, null, "HACKED"), new ParamMapping("id", SourceType.CONSTANT, null, null, "1")),
                    step(2, "insert", insert, List.of(), List.of(), new ParamMapping("id", SourceType.CONSTANT, null, null, "77"), new ParamMapping("customer", SourceType.CONSTANT, null, null, "C100"),
                            new ParamMapping("d", SourceType.CONSTANT, null, null, "2030-01-01"), new ParamMapping("status", SourceType.CONSTANT, null, null, "HACKED")),
                    step(3, "delete", delete, List.of(), List.of(), new ParamMapping("id", SourceType.CONSTANT, null, null, "2")),
                    step(4, "select still works", select, List.of(), List.of())))); 

            RunView run = executor.runNow(w.id(), Map.of(), Map.of(), List.of());

            for (int i = 0; i < 3; i++) {
                String verb = List.of("UPDATE", "INSERT", "DELETE").get(i);
                var st = run.steps().get(i);
                assertEquals("FAILED", st.status(), verb + " must be rejected");
                assertTrue(st.error().contains("SQLState 42000") && st.error().contains("code 1142") && st.error().contains(verb + " command denied to user 'limited'"),
                        "the actual MySQL error, not a workflow message: " + st.error());
            }
            assertEquals("SUCCESS", run.steps().get(3).status(), "the SELECT privilege is respected too");
            assertEquals("4", String.valueOf(run.steps().get(3).result().rows().get(0).get(0)));
            assertEquals("4", scalar("SELECT COUNT(*) FROM " + table), "nothing was inserted or deleted");
            assertEquals("4", scalar("SELECT COUNT(*) FROM " + table + " WHERE status = 'OPEN'"), "nothing was updated");
        } finally {
            dropFixture();
        }
    }

    @Test
    void apiWorkflowSqlStepsAlsoRunWritesDirectly() throws Exception {
        fixture();
        try {
            SessionContext.set("s-" + u);
            ConnectionView c = mysqlAs("api-wf-write-", MYSQL_USER, MYSQL_PW);
            connections.connect(c.id(), ACCESS);
            connections.useDatabase("bank_wallet", DbType.MYSQL);
            SavedQuery update = sqlQuery("aupd-", QueryType.WRITE, "UPDATE " + table + " SET status = ? WHERE customer_id = ?", p("status", ParamType.STRING), p("customer", ParamType.STRING));
            SavedQuery check = sqlQuery("achk-", QueryType.READ, "SELECT COUNT(*) AS n FROM " + table + " WHERE status = ?", p("status", ParamType.STRING));
            var options = new ApiStepOptions(0, 1, 30, 1, List.of(), List.of());
            ApiWorkflowDef def = apiWorkflows.save(null, new ApiWorkflowDef(null, "api-sql-write-" + u, null, true, 120, List.of(
                    new ApiWfStep(null, 1, "set status", 0L, null, null, "STOP", true, options, "SQL_QUERY", update.id(), update.name(), Map.of("status", "DONE", "customer", "C100")),
                    new ApiWfStep(null, 2, "count", 0L, null, null, "STOP", true, options, "SQL_QUERY", check.id(), check.name(), Map.of("status", "DONE")))));
            String runId = apiRunner.start(def.id(), Map.of());
            ApiRunView done = apiRunner.get(runId);
            for (int i = 0; i < 100 && !List.of("SUCCESS", "FAILED").contains(done.status()); i++) {
                Thread.sleep(100);
                done = apiRunner.get(runId);
            }
            assertEquals("SUCCESS", done.status(), done.error());
            assertEquals("3", scalar("SELECT COUNT(*) FROM " + table + " WHERE status = 'DONE'"), "three C100 rows were updated for real");
            assertEquals("1", scalar("SELECT COUNT(*) FROM " + table + " WHERE status = 'OPEN'"));
        } finally {
            dropFixture();
        }
    }

    // ------------------------------------------------------------------ runtime inputs and flexible variables on the real databases

    @Test
    void automaticOverrideDefaultAndEmptyValuesWorkTogetherOnRealMySql() throws Exception {
        fixture();
        try {
            SessionContext.set("s-" + u);
            connections.connect(mysqlAs("rt-mysql-", MYSQL_USER, MYSQL_PW).id(), ACCESS);
            connections.useDatabase("bank_wallet", DbType.MYSQL);

            SavedQuery fetch = sqlQuery("rtfetch-", QueryType.READ, "SELECT id, scheduled_date FROM " + table + " WHERE customer_id = ? ORDER BY id DESC", p("customer_id", ParamType.STRING));
            SavedQuery update = sqlQuery("rtupd-", QueryType.WRITE, "UPDATE " + table + " SET scheduled_date = ?, status = ? WHERE id = ?",
                    p("d", ParamType.DATE), new QueryParameter("status", "Status", ParamType.STRING, false, "FROM_QUERY_DEFAULT"), p("id", ParamType.INTEGER));
            SavedQuery insert = sqlQuery("rtins-", QueryType.WRITE, "INSERT INTO " + table + " (id, customer_id, scheduled_date, status) VALUES (?, ?, ?, ?)",
                    p("id", ParamType.INTEGER), p("customer", ParamType.STRING), p("d", ParamType.DATE), new QueryParameter("status", "Status", ParamType.STRING, false, null));
            Workflow w = workflows.create(new Workflow(null, "rt-real-" + u, null,
                    List.of(new WorkflowInput("customerId", "Customer", ParamType.STRING, true, "C100"), new WorkflowInput("newDate", "New date", ParamType.DATE, false)),
                    List.of(
                            step(1, "fetch (no outputs declared)", fetch, List.of(), List.of(), new ParamMapping("customer_id", SourceType.INPUT, "customerId", null, null)),
                            step(2, "update the second newest row", update, List.of(1), List.of(), new ParamMapping("d", SourceType.CONSTANT, null, null, "2026-11-01"),
                                    new ParamMapping("id", SourceType.STEP_OUTPUT, "1", "rows.1.id", null)),
                            step(3, "insert with an optional empty status", insert, List.of(2), List.of(), new ParamMapping("id", SourceType.CONSTANT, null, null, "60"),
                                    new ParamMapping("customer", SourceType.INPUT, "customerId", null, null), new ParamMapping("d", SourceType.INPUT, "newDate", null, null)))));

            // 1) nothing typed: the workflow input default (C100) is used, the second-newest row comes from the retained result, the optional status is the query default,
            //    and the date input is empty -> step 3 needs it (required parameter) so it is genuinely blocked, step 2 still ran
            RunView first = executor.runNow(w.id(), Map.of(), Map.of(), List.of());
            assertEquals("C100", first.inputs().get("customerId"));
            assertEquals("2", first.steps().get(1).params().get("id"), "rows.1.id: the second row of step 1's retained result");
            assertEquals("SUCCESS", first.steps().get(1).status());
            assertEquals("FROM_QUERY_DEFAULT", scalar("SELECT status FROM " + table + " WHERE id = 2"));
            assertEquals("BLOCKED", first.steps().get(2).status(), "a required value that really is missing blocks only that step");
            assertNull(scalar("SELECT id FROM " + table + " WHERE id = 60"));

            // 2) runtime inputs: a date for the workflow input, a runtime override of one step parameter for this run only
            RunView second = executor.runNow(w.id(), Map.of("newDate", "2031-05-05"), Map.of(2, Map.of("status", "OVERRIDDEN")), List.of());
            assertEquals("SUCCESS", second.status(), second.steps().toString());
            assertEquals("OVERRIDDEN", scalar("SELECT status FROM " + table + " WHERE id = 2"), "runtime override beat the default");
            assertEquals("2031-05-05", scalar("SELECT scheduled_date FROM " + table + " WHERE id = 60"), "the typed date reached the INSERT");
            assertNull(scalar("SELECT status FROM " + table + " WHERE id = 60"), "the optional, unmapped, default-less status was stored as NULL, not blocked");
            assertEquals("1", scalar("SELECT COUNT(*) FROM " + table + " WHERE id = 60 AND status IS NULL"));

            // 3) the override was for one run only: running again without it uses the default again
            try (Connection c = direct(); Statement st = c.createStatement()) {
                st.execute("DELETE FROM " + table + " WHERE id = 60");
            }
            RunView third = executor.runNow(w.id(), Map.of("newDate", "2031-06-06"), Map.of(), List.of());
            assertEquals("SUCCESS", third.status(), third.steps().toString());
            assertEquals("FROM_QUERY_DEFAULT", scalar("SELECT status FROM " + table + " WHERE id = 2"));
            assertEquals("2031-06-06", scalar("SELECT scheduled_date FROM " + table + " WHERE id = 60"));
        } finally {
            dropFixture();
        }
    }

    @Test
    void aMongoStepsRetainedResponseFeedsAMySqlStepWithoutAnyOutputDefinition() {
        SessionContext.set("s-" + u);
        connections.connect(mongoUri("rt-mongo-", "QA").id(), ACCESS);
        connections.useDatabase("qa_customers", DbType.MONGODB);
        connections.connect(mysql("rt-my-").id(), ACCESS);
        connections.useDatabase("bank_wallet", DbType.MYSQL);
        SavedQuery fromMongo = mongoQuery("rt-m-", "{\"collection\":\"customers\",\"filter\":{\"customerId\":\"?\"}}", p("customerId", ParamType.STRING));
        SavedQuery inMysql = sqlQuery("rt-s-", QueryType.READ, "SELECT name, ? AS tag FROM bank_wallet.customers WHERE customer_id = ?", p("tag", ParamType.STRING), p("customer_id", ParamType.STRING));
        Workflow w = workflows.create(new Workflow(null, "rt-cross-" + u, null, List.of(new WorkflowInput("customer", "Customer", ParamType.STRING, false, "C200")), List.of(
                step(1, "mongo customer", fromMongo, List.of(), List.of(), new ParamMapping("customerId", SourceType.INPUT, "customer", null, null)),
                step(2, "mysql customer by the mongo document's customerId", inMysql, List.of(1), List.of(),
                        new ParamMapping("customer_id", SourceType.STEP_OUTPUT, "1", "rows.0.customerId", null),
                        new ParamMapping("tag", SourceType.CONSTANT, null, null, "{{step1.rows.0.address}} / {{step1.rows.0.name}}")))));
        RunView run = executor.runNow(w.id(), Map.of(), Map.of(), List.of());
        assertEquals("SUCCESS", run.status(), run.steps().toString());
        assertEquals("C200", run.steps().get(1).params().get("customer_id"), "the default input C200 flowed Mongo -> MySQL");
        assertEquals("Ravi", run.steps().get(1).result().rows().get(0).get(0));
        assertEquals("{\"city\": \"Mumbai\"} / Ravi", run.steps().get(1).result().rows().get(0).get(1), "{{stepN.path}} read the retained Mongo document");
        RunView typed = executor.runNow(w.id(), Map.of("customer", "C100"), Map.of(), List.of());
        assertEquals("Asha", typed.steps().get(1).result().rows().get(0).get(0), "a runtime value beats the input default");
    }
}
