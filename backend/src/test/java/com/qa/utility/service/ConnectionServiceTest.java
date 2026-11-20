package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.config.AppProperties;
import com.qa.utility.connection.ConnectionRegistry;
import com.qa.utility.connection.DbAdapter;
import com.qa.utility.connection.Probe;
import com.qa.utility.dto.ConnectionDtos.ConnectionRequest;
import com.qa.utility.dto.ConnectionDtos.TestResult;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import com.qa.utility.repository.ConnectionProfileRepository;
import com.qa.utility.security.AccessPasswordService;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.CryptoService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ConnectionServiceTest {
    @Mock
    ConnectionProfileRepository repo;
    @Mock
    AuditService audit;
    @Mock
    DbAdapter mysql;
    @Mock
    DbAdapter mongo;

    ConnectionService service;
    ConnectionRegistry registry;
    CryptoService crypto;
    AccessPasswordService access;
    final AppProperties props = new AppProperties("target/test-data", List.of("QA", "STAGING", "DEV"), List.of("prod", "prd", "production", "live"),
            List.of(), "unit-test-key", 5000, 100, 120, 20, 300, 50);

    @BeforeEach
    void setUp() {
        crypto = new CryptoService(props);
        access = new AccessPasswordService();
        when(mysql.type()).thenReturn(DbType.MYSQL);
        when(mongo.type()).thenReturn(DbType.MONGODB);
        registry = new ConnectionRegistry(60);
        service = new ConnectionService(repo, registry, new ConnectionPolicy(props), crypto, audit, access, List.of(mysql, mongo));
    }

    private ConnectionRequest mysqlReq(String env, String host, String db) {
        return new ConnectionRequest("qa-main", env, "MYSQL", host, 3306, db, "qa_user", "s3cret!", false, null, null, false, "Darshan", "open-sesame", null);
    }

    private static ConnectionRequest noDb(ConnectionRequest r) {
        return new ConnectionRequest(r.name(), r.environment(), r.dbType(), r.host(), r.port(), null, r.username(), r.password(), r.useUri(), r.uri(), r.authDatabase(),
                r.tls(), r.ownerName(), r.accessPassword(), r.newAccessPassword());
    }

    private ConnectionRequest mongoReq(String env, String host, String uri, boolean useUri) {
        return new ConnectionRequest("mongo-main", env, "MONGODB", host, 27017, "customers", "mongo_user", "mongo-pw", useUri, uri, "admin", true, "Darshan", "open-sesame", null);
    }

    private static ConnectionProfile withId(ConnectionProfile p) {
        return new ConnectionProfile(7L, p.name(), p.environment(), p.host(), p.port(), p.databaseName(), p.username(), p.passwordEncrypted(), p.dbType(),
                p.ownerName(), p.accessPasswordHash(), p.uriEncrypted(), p.authDatabase(), p.tls());
    }

    private ConnectionProfile stored(String accessPw) {
        return new ConnectionProfile(1L, "qa", "QA", "db.qa.internal", 3306, "bank", "u", crypto.encrypt("pw"), DbType.MYSQL, "Darshan",
                accessPw == null ? null : access.hash(accessPw), null, null, false);
    }

    @Test
    void connectionFailureIsReportedNotThrown() throws Exception {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        when(mysql.probe(any(), any())).thenThrow(new java.sql.SQLException("Communications link failure"));
        TestResult r = service.testSaved(1L, "open-sesame");
        assertFalse(r.success());
        assertEquals("Communications link failure", r.message());
    }

    @Test
    void successfulTestReturnsLatencyAndVersion() throws Exception {
        when(mysql.probe(any(), any())).thenReturn(new Probe(12, "MySQL 8.0.36"));
        TestResult r = service.testUnsaved(mysqlReq("QA", "db.qa.internal", "bank"));
        assertTrue(r.success());
        assertEquals("MySQL 8.0.36", r.serverVersion());
    }

    @Test
    void onlyApprovedEnvironmentsAndNeverProduction() {
        assertThrows(ApiException.class, () -> service.create(mysqlReq("PROD", "db.qa.internal", "bank")));
        assertThrows(ApiException.class, () -> service.create(mysqlReq("QA", "db-prod.company.com", "bank")));
        assertThrows(ApiException.class, () -> service.create(mysqlReq("UAT", "db.uat.internal", "bank_production")));
        assertThrows(ApiException.class, () -> service.create(mysqlReq("QA", "host/evil?allowLoadLocalInfile=true", "bank")));
        verify(repo, never()).insert(any());
    }

    @Test
    void uatIsStillAcceptedAndStoredAsStaging() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        assertEquals("STAGING", service.create(mysqlReq("UAT", "db.staging.internal", "bank")).environment());
        assertEquals("STAGING", service.create(mysqlReq("Staging", "db.staging.internal", "bank")).environment());
    }

    @Test
    void theDatabaseNameIsOptionalForBothTypes() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        service.create(mysqlReq("QA", "db.qa.internal", null));
        service.create(noDb(mongoReq("QA", "mongo.qa.internal", null, false)));
        ConnectionRequest uri = new ConnectionRequest("m2", "QA", "MONGODB", null, 0, "", null, null, true, "mongodb://u:p@mongo.qa.internal/", null, false, null, "open-sesame", null);
        service.create(uri);
        var captor = ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo, times(3)).insert(captor.capture());
        assertTrue(captor.getAllValues().stream().allMatch(p -> p.databaseName() == null), "no database stored: it is chosen after connecting");
    }

    @Test
    void developmentEnvironmentIsAccepted() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        assertEquals("DEV", service.create(mysqlReq("Development", "db.dev.internal", "bank")).environment());
    }

    @Test
    void secretsAreEncryptedAtRestAndNeverReturned() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        var view = service.create(mysqlReq("QA", "db.qa.internal", "bank"));
        var captor = ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo).insert(captor.capture());
        ConnectionProfile saved = captor.getValue();
        assertNotEquals("s3cret!", saved.passwordEncrypted());
        assertTrue(saved.passwordEncrypted().startsWith("v2:"), "envelope format");
        assertEquals("s3cret!", crypto.decrypt(saved.passwordEncrypted()));
        assertFalse(saved.accessPasswordHash().contains("open-sesame"));
        assertTrue(access.matches("open-sesame", saved.accessPasswordHash()));
        assertFalse(view.toString().contains("s3cret"));
        assertFalse(view.toString().contains("open-sesame"));
        assertTrue(view.passwordProtected());
    }

    @Test
    void anAccessPasswordIsRequiredToCreateAConnection() {
        ConnectionRequest r = new ConnectionRequest("x", "QA", "MYSQL", "db.qa.internal", 3306, "bank", "u", "pw", false, null, null, false, null, "", null);
        assertThrows(ApiException.class, () -> service.create(r));
        verify(repo, never()).insert(any());
    }

    @Test
    void wrongAccessPasswordBlocksConnectTestEditAndDelete() throws Exception {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        assertEquals(403, assertThrows(ApiException.class, () -> service.connect(1L, "guess")).status().value());
        assertThrows(ApiException.class, () -> service.testSaved(1L, "guess"));
        assertThrows(ApiException.class, () -> service.testSaved(1L, null));
        assertThrows(ApiException.class, () -> service.delete(1L, "guess"));
        ConnectionRequest edit = new ConnectionRequest("renamed", "QA", "MYSQL", "db.qa.internal", 3306, "bank", "u", null, false, null, null, false, null, "guess", null);
        assertThrows(ApiException.class, () -> service.update(1L, edit));
        verify(mysql, never()).open(any(), any());
        verify(mysql, never()).probe(any(), any());
        verify(repo, never()).delete(anyLong());
        verify(repo, never()).update(any());
    }

    @Test
    void rightAccessPasswordAllowsDeleteAndEdit() {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        service.delete(1L, "open-sesame");
        verify(repo).delete(1L);
        ConnectionRequest edit = new ConnectionRequest("renamed", "QA", "MYSQL", "db.qa.internal", 3306, "bank", "u", null, false, null, null, false, null, "open-sesame", "brand-new-pw");
        service.update(1L, edit);
        var captor = ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo).update(captor.capture());
        assertTrue(access.matches("brand-new-pw", captor.getValue().accessPasswordHash()));
        assertEquals(stored("xxxxxx").passwordEncrypted().substring(0, 3), captor.getValue().passwordEncrypted().substring(0, 3)); // kept the stored DB password
    }

    @Test
    void repeatedWrongGuessesLockTheConnection() {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        for (int i = 0; i < 5; i++) assertThrows(ApiException.class, () -> service.connect(1L, "nope"));
        ApiException locked = assertThrows(ApiException.class, () -> service.connect(1L, "open-sesame"));
        assertEquals(429, locked.status().value()); // even the right password waits out the lock
    }

    @Test
    void legacyConnectionWithoutAccessPasswordMustGetOneFirst() {
        when(repo.findById(1L)).thenReturn(Optional.of(stored(null)));
        assertEquals(428, assertThrows(ApiException.class, () -> service.connect(1L, "anything")).status().value());
        service.setAccessPassword(1L, "chosen-pw");
        verify(repo).setAccessPasswordHash(eq(1L), argThat(h -> access.matches("chosen-pw", h)));
        when(repo.findById(1L)).thenReturn(Optional.of(stored("chosen-pw")));
        assertThrows(ApiException.class, () -> service.setAccessPassword(1L, "hijack-it"), "cannot be reset without the current password");
    }

    @Test
    void connectFailureIsAudited() throws Exception {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        when(mysql.open(any(), any())).thenThrow(new IllegalStateException("refused"));
        assertThrows(ApiException.class, () -> service.connect(1L, "open-sesame"));
        verify(audit).record(eq("CONNECT"), any(), any(), any(), any(), eq("FAILED"), anyString());
    }

    @Test
    void statusWhenNotConnected() {
        assertFalse(service.status().connected());
        assertTrue(service.statuses().isEmpty());
    }

    @Test
    void mongoHostModeStoresEncryptedPasswordAndTls() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        var view = service.create(mongoReq("Staging", "mongo.staging.internal", null, false));
        var captor = ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo).insert(captor.capture());
        ConnectionProfile p = captor.getValue();
        assertEquals(DbType.MONGODB, p.dbType());
        assertEquals("admin", p.authDatabase());
        assertTrue(p.tls());
        assertEquals("mongo-pw", crypto.decrypt(p.passwordEncrypted()));
        assertEquals("MONGODB", view.dbType());
    }

    @Test
    void mongoUriIsEncryptedAndNeverReturned() {
        when(repo.insert(any())).thenAnswer(inv -> withId(inv.getArgument(0, ConnectionProfile.class)));
        String uri = "mongodb://app:topsecret@mongo.qa.internal:27018/customers?authSource=admin";
        var view = service.create(mongoReq("QA", null, uri, true));
        var captor = ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo).insert(captor.capture());
        ConnectionProfile p = captor.getValue();
        assertEquals(uri, crypto.decrypt(p.uriEncrypted()));
        assertEquals("mongo.qa.internal", p.host());
        assertEquals(27018, p.port());
        assertNull(p.passwordEncrypted());
        assertTrue(view.usesUri());
        assertFalse(view.toString().contains("topsecret"));
    }

    @Test
    void mongoUriRulesRejectProductionInsecureTlsAndGarbage() {
        assertThrows(ApiException.class, () -> service.create(mongoReq("QA", null, "mongodb://u:p@mongo-prod.company.com/customers", true)));
        assertThrows(ApiException.class, () -> service.create(mongoReq("QA", null, "mongodb://u:p@mongo.qa.internal/customers?tlsInsecure=true", true)));
        assertThrows(ApiException.class, () -> service.create(mongoReq("QA", null, "http://not-mongo", true)));
        assertThrows(ApiException.class, () -> service.create(mongoReq("QA", null, "mongodb://u:p@a,b-live.company.com/customers", true)));
        verify(repo, never()).insert(any());
    }

    /** A live connection whose server refuses to list databases for the user. */
    static final class RestrictedLive implements com.qa.utility.connection.LiveConnection {
        volatile String selected;

        public ConnectionProfile profile() {
            return new ConnectionProfile(9L, "restricted", "QA", "h", 27017, null, "u", null, DbType.MONGODB, null, null, null, null, false);
        }

        public DbType type() {
            return DbType.MONGODB;
        }

        public Discovery discoverDatabases() {
            return new Discovery(List.of(), true, "The server did not allow listing databases for this user. Type the database name to use.");
        }

        public String selectedDatabase() {
            return selected;
        }

        public void selectDatabase(String name) {
            selected = name;
        }

        public long ping() {
            return 1;
        }

        public void close() {
        }
    }

    @Test
    void whenTheServerWillNotListDatabasesTheUserCanTypeOneAndTheServerStillEnforcesAccess() {
        com.qa.utility.security.SessionContext.set("restricted-test");
        try {
            RestrictedLive live = new RestrictedLive();
            registry.register(live);
            var list = service.databases(DbType.MONGODB);
            assertTrue(list.restricted());
            assertTrue(list.databases().isEmpty());
            assertNotNull(list.message());
            assertEquals("typed_db", service.useDatabase("typed_db", DbType.MONGODB).databaseName());
            assertEquals("typed_db", service.databases(DbType.MONGODB).selected());
            assertThrows(ApiException.class, () -> service.useDatabase("prod_ledger", DbType.MONGODB), "blocked names are refused even when typed");
            assertThrows(ApiException.class, () -> service.useDatabase("bad name!", DbType.MONGODB));
        } finally {
            com.qa.utility.security.SessionContext.clear();
        }
    }

    @Test
    void databaseTypeOfAnExistingConnectionCannotBeChanged() {
        when(repo.findById(1L)).thenReturn(Optional.of(stored("open-sesame")));
        ConnectionRequest edit = new ConnectionRequest("qa", "QA", "MONGODB", "h", 27017, "d", null, null, false, null, null, false, null, "open-sesame", null);
        assertThrows(ApiException.class, () -> service.update(1L, edit));
    }
}
