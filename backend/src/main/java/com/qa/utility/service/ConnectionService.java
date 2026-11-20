package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.dto.ConnectionDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.repository.ConnectionProfileRepository;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.CryptoService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

@Service
public class ConnectionService {
    private final ConnectionProfileRepository repo;
    private final ActiveConnectionManager manager;
    private final ConnectionPolicy policy;
    private final CryptoService crypto;
    private final AuditService audit;

    public ConnectionService(ConnectionProfileRepository repo, ActiveConnectionManager manager, ConnectionPolicy policy,
                             CryptoService crypto, AuditService audit) {
        this.repo = repo;
        this.manager = manager;
        this.policy = policy;
        this.crypto = crypto;
        this.audit = audit;
    }

    public List<ConnectionView> list() {
        Long activeId = manager.activeProfile().map(ConnectionProfile::id).orElse(null);
        return repo.findAll().stream().map(p -> view(p, p.id().equals(activeId))).toList();
    }

    public ConnectionView create(ConnectionRequest r) {
        if (r.password() == null || r.password().isEmpty()) throw ApiException.badRequest("Password is required");
        policy.validate(r.environment(), r.host(), r.port(), r.databaseName());
        try {
            ConnectionProfile p = repo.insert(new ConnectionProfile(null, r.name().trim(), policy.normaliseEnvironment(r.environment()),
                    r.host().trim(), r.port(), r.databaseName().trim(), r.username(), crypto.encrypt(r.password())));
            audit.record("CONNECTION_CREATED", p, null, null, null, "SUCCESS", null);
            return view(p, false);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A connection named '" + r.name() + "' already exists");
        }
    }

    public ConnectionView update(long id, ConnectionRequest r) {
        ConnectionProfile old = get(id);
        policy.validate(r.environment(), r.host(), r.port(), r.databaseName());
        String pw = r.password() == null || r.password().isEmpty() ? old.passwordEncrypted() : crypto.encrypt(r.password());
        ConnectionProfile p = new ConnectionProfile(id, r.name().trim(), policy.normaliseEnvironment(r.environment()),
                r.host().trim(), r.port(), r.databaseName().trim(), r.username(), pw);
        try {
            repo.update(p);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A connection named '" + r.name() + "' already exists");
        }
        if (manager.activeProfile().map(a -> a.id().equals(id)).orElse(false)) manager.disconnect();
        audit.record("CONNECTION_UPDATED", p, null, null, null, "SUCCESS", null);
        return view(p, false);
    }

    public void delete(long id) {
        ConnectionProfile p = get(id);
        if (manager.activeProfile().map(a -> a.id().equals(id)).orElse(false)) manager.disconnect();
        repo.delete(id);
        audit.record("CONNECTION_DELETED", p, null, null, null, "SUCCESS", null);
    }

    public TestResult testSaved(long id) {
        ConnectionProfile p = get(id);
        return runTest(p, crypto.decrypt(p.passwordEncrypted()));
    }

    public TestResult testUnsaved(ConnectionRequest r) {
        policy.validate(r.environment(), r.host(), r.port(), r.databaseName());
        if (r.password() == null) throw ApiException.badRequest("Password is required to test");
        return runTest(new ConnectionProfile(null, r.name(), policy.normaliseEnvironment(r.environment()), r.host(), r.port(),
                r.databaseName(), r.username(), null), r.password());
    }

    private TestResult runTest(ConnectionProfile p, String password) {
        policy.validate(p.environment(), p.host(), p.port(), p.databaseName());
        StringBuilder version = new StringBuilder();
        try {
            long ms = manager.test(p, password, version);
            return new TestResult(true, ms, version.toString(), "Connection successful");
        } catch (SQLException e) {
            return new TestResult(false, 0, null, ActiveConnectionManager.rootMessage(e));
        }
    }

    public StatusView connect(long id) {
        ConnectionProfile p = get(id);
        policy.validate(p.environment(), p.host(), p.port(), p.databaseName());
        try {
            manager.connect(p, crypto.decrypt(p.passwordEncrypted()));
        } catch (ApiException e) {
            audit.record("CONNECT", p, null, null, null, "FAILED", e.getMessage());
            throw e;
        }
        audit.record("CONNECT", p, null, null, null, "SUCCESS", null);
        return status();
    }

    public StatusView disconnect() {
        manager.activeProfile().ifPresent(p -> audit.record("DISCONNECT", p, null, null, null, "SUCCESS", null));
        manager.disconnect();
        return status();
    }

    private static final java.util.Set<String> SYSTEM_SCHEMAS =
            java.util.Set.of("information_schema", "mysql", "performance_schema", "sys");

    /** Databases visible to the connected user (system schemas hidden) plus the one currently selected. */
    public DatabaseList databases() {
        ConnectionProfile p = manager.activeProfile()
                .orElseThrow(() -> ApiException.conflict("Not connected. Connect to a profile first."));
        List<String> names = new JdbcTemplate(manager.current()).queryForList("SHOW DATABASES", String.class).stream()
                .filter(n -> !SYSTEM_SCHEMAS.contains(n.toLowerCase())).sorted(String.CASE_INSENSITIVE_ORDER).toList();
        return new DatabaseList(names, p.databaseName());
    }

    public StatusView useDatabase(String name) {
        ConnectionProfile p = manager.activeProfile()
                .orElseThrow(() -> ApiException.conflict("Not connected. Connect to a profile first."));
        if (!databases().databases().contains(name)) throw ApiException.badRequest("Database '" + name + "' is not visible to this user");
        policy.validate(p.environment(), p.host(), p.port(), name);
        try {
            manager.switchDatabase(name);
        } catch (ApiException e) {
            audit.record("SWITCH_DATABASE", p, null, null, null, "FAILED", e.getMessage());
            throw e;
        }
        audit.record("SWITCH_DATABASE", manager.activeProfile().orElse(p), null, null, null, "SUCCESS", null);
        return status();
    }

    /** Live health check: pings the active pool. */
    public StatusView status() {
        var active = manager.activeProfile();
        if (active.isEmpty()) return new StatusView(false, null, null, null, null, null, null, "Not connected");
        ConnectionProfile p = active.get();
        long start = System.currentTimeMillis();
        try (Connection c = manager.current().getConnection()) {
            if (!c.isValid(5)) throw new SQLException("Connection is no longer valid");
            new JdbcTemplate(manager.current()).queryForObject("SELECT 1", Integer.class);
            return new StatusView(true, p.id(), p.name(), p.environment(), p.host(), p.databaseName(),
                    System.currentTimeMillis() - start, "Connected");
        } catch (Exception e) {
            return new StatusView(false, p.id(), p.name(), p.environment(), p.host(), p.databaseName(), null,
                    "Connection lost: " + ActiveConnectionManager.rootMessage(e));
        }
    }

    private ConnectionProfile get(long id) {
        return repo.findById(id).orElseThrow(() -> ApiException.notFound("Connection profile not found"));
    }

    private static ConnectionView view(ConnectionProfile p, boolean active) {
        return new ConnectionView(p.id(), p.name(), p.environment(), p.host(), p.port(), p.databaseName(), p.username(), active);
    }
}
