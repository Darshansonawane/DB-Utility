package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.config.AppProperties;
import com.qa.utility.dto.ConnectionDtos.ConnectionRequest;
import com.qa.utility.dto.ConnectionDtos.TestResult;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.repository.ConnectionProfileRepository;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.CryptoService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.sql.SQLException;
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
    ActiveConnectionManager manager;
    @Mock
    AuditService audit;

    ConnectionService service;
    CryptoService crypto;
    final AppProperties props = new AppProperties("target/test-data", List.of("QA", "UAT"), List.of("prod", "prd", "production", "live"),
            List.of(), "unit-test-key", 5000, 100, 120, 20, 300, 50);

    @BeforeEach
    void setUp() {
        crypto = new CryptoService(props);
        service = new ConnectionService(repo, manager, new ConnectionPolicy(props), crypto, audit);
    }

    private ConnectionRequest req(String env, String host, String db) {
        return new ConnectionRequest("qa-main", env, host, 3306, db, "qa_user", "s3cret!");
    }

    @Test
    void connectionFailureIsReportedNotThrown() throws Exception {
        String enc = crypto.encrypt("pw");
        when(repo.findById(1L)).thenReturn(Optional.of(new ConnectionProfile(1L, "qa", "QA", "db.qa.internal", 3306, "bank", "u", enc)));
        when(manager.test(any(), eq("pw"), any())).thenThrow(new SQLException("Communications link failure"));
        TestResult r = service.testSaved(1L);
        assertFalse(r.success());
        assertEquals("Communications link failure", r.message());
    }

    @Test
    void successfulTestReturnsLatency() throws Exception {
        when(manager.test(any(), anyString(), any())).thenAnswer(inv -> {
            ((StringBuilder) inv.getArgument(2)).append("8.0.36");
            return 12L;
        });
        TestResult r = service.testUnsaved(req("QA", "db.qa.internal", "bank"));
        assertTrue(r.success());
        assertEquals("8.0.36", r.serverVersion());
    }

    @Test
    void onlyApprovedEnvironmentsAndNeverProduction() {
        assertThrows(ApiException.class, () -> service.create(req("PROD", "db.qa.internal", "bank")));
        assertThrows(ApiException.class, () -> service.create(req("QA", "db-prod.company.com", "bank")));
        assertThrows(ApiException.class, () -> service.create(req("UAT", "db.uat.internal", "bank_production")));
        assertThrows(ApiException.class, () -> service.create(req("QA", "host/evil?allowLoadLocalInfile=true", "bank")));
        verify(repo, never()).insert(any());
    }

    @Test
    void passwordIsEncryptedAtRestAndNeverReturned() {
        when(repo.insert(any())).thenAnswer(inv -> inv.getArgument(0, ConnectionProfile.class));
        var view = service.create(req("QA", "db.qa.internal", "bank"));
        var captor = org.mockito.ArgumentCaptor.forClass(ConnectionProfile.class);
        verify(repo).insert(captor.capture());
        assertNotEquals("s3cret!", captor.getValue().passwordEncrypted());
        assertEquals("s3cret!", crypto.decrypt(captor.getValue().passwordEncrypted()));
        assertFalse(view.toString().contains("s3cret"));
    }

    @Test
    void connectFailureIsAudited() {
        String enc = crypto.encrypt("pw");
        ConnectionProfile p = new ConnectionProfile(1L, "qa", "QA", "db.qa.internal", 3306, "bank", "u", enc);
        when(repo.findById(1L)).thenReturn(Optional.of(p));
        doThrow(ApiException.badRequest("Could not connect: refused")).when(manager).connect(any(), anyString());
        assertThrows(ApiException.class, () -> service.connect(1L));
        verify(audit).record(eq("CONNECT"), any(), any(), any(), any(), eq("FAILED"), anyString());
    }

    @Test
    void statusWhenNotConnected() {
        when(manager.activeProfile()).thenReturn(Optional.empty());
        assertFalse(service.status().connected());
    }
}
