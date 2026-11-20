package com.qa.utility.service;

import com.mongodb.ConnectionString;
import com.qa.utility.audit.AuditService;
import com.qa.utility.connection.ConnectionRegistry;
import com.qa.utility.connection.ConnectionSecrets;
import com.qa.utility.connection.DbAdapter;
import com.qa.utility.connection.Errors;
import com.qa.utility.connection.LiveConnection;
import com.qa.utility.connection.MySqlLive;
import com.qa.utility.connection.Probe;
import com.qa.utility.dto.ConnectionDtos.*;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import com.qa.utility.repository.ConnectionProfileRepository;
import com.qa.utility.security.AccessPasswordService;
import com.qa.utility.security.ConnectionPolicy;
import com.qa.utility.security.CryptoService;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Connection profiles for MySQL and MongoDB. Every action on a saved connection (connect, test, edit, delete) first verifies that
 * connection's own access password. Live connections are held per browser session in {@link ConnectionRegistry}, independently.
 */
@Service
public class ConnectionService {
    private static final java.util.Set<String> SYSTEM_SCHEMAS = java.util.Set.of("information_schema", "mysql", "performance_schema", "sys");

    private final ConnectionProfileRepository repo;
    private final ConnectionRegistry registry;
    private final ConnectionPolicy policy;
    private final CryptoService crypto;
    private final AuditService audit;
    private final AccessPasswordService access;
    private final Map<DbType, DbAdapter> adapters = new EnumMap<>(DbType.class);

    public ConnectionService(ConnectionProfileRepository repo, ConnectionRegistry registry, ConnectionPolicy policy, CryptoService crypto,
                             AuditService audit, AccessPasswordService access, List<DbAdapter> adapterList) {
        this.repo = repo;
        this.registry = registry;
        this.policy = policy;
        this.crypto = crypto;
        this.audit = audit;
        this.access = access;
        adapterList.forEach(a -> adapters.put(a.type(), a));
    }

    // ------------------------------------------------------------------ list / CRUD

    public List<ConnectionView> list() {
        return repo.findAll().stream().map(this::view).toList();
    }

    public ConnectionView create(ConnectionRequest r) {
        DbType type = DbType.parse(r.dbType());
        String hash = access.hash(r.accessPassword()); // an access password is mandatory
        ConnectionProfile built = build(null, r, type, null, hash);
        try {
            ConnectionProfile p = repo.insert(built);
            audit.record("CONNECTION_CREATED", p, null, null, null, "SUCCESS", type.name());
            return view(p);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A connection named '" + r.name() + "' already exists");
        }
    }

    public ConnectionView update(long id, ConnectionRequest r) {
        ConnectionProfile old = authorised(id, r.accessPassword());
        if (r.dbType() != null && !r.dbType().isBlank() && DbType.parse(r.dbType()) != old.dbType()) {
            throw ApiException.badRequest("The database type of an existing connection cannot be changed. Create a new connection instead.");
        }
        String hash = r.newAccessPassword() == null || r.newAccessPassword().isEmpty() ? old.accessPasswordHash() : access.hash(r.newAccessPassword());
        ConnectionProfile p = build(id, r, old.dbType(), old, hash);
        try {
            repo.update(p);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A connection named '" + r.name() + "' already exists");
        }
        registry.disconnectEverywhere(id); // only this connection is closed; every other one is untouched
        audit.record("CONNECTION_UPDATED", p, null, null, null, "SUCCESS", null);
        return view(repo.findById(id).orElse(p));
    }

    public void delete(long id, String accessPassword) {
        ConnectionProfile p = authorised(id, accessPassword);
        registry.disconnectEverywhere(id);
        repo.delete(id);
        access.forget(id);
        audit.record("CONNECTION_DELETED", p, null, null, null, "SUCCESS", null);
    }

    /** For connections created before access passwords existed: the first person to open one chooses its password. */
    public ConnectionView setAccessPassword(long id, String newPassword) {
        ConnectionProfile p = get(id);
        if (p.passwordProtected()) throw ApiException.conflict("This connection already has an access password. Change it from Edit.");
        repo.setAccessPasswordHash(id, access.hash(newPassword));
        audit.record("CONNECTION_PROTECTED", p, null, null, null, "SUCCESS", null);
        return view(get(id));
    }

    // ------------------------------------------------------------------ test / connect / disconnect

    public TestResult testSaved(long id, String accessPassword) {
        ConnectionProfile p = authorised(id, accessPassword);
        return runTest(p, secretsOf(p));
    }

    public TestResult testUnsaved(ConnectionRequest r) {
        DbType type = DbType.parse(r.dbType());
        ConnectionProfile p = build(null, r, type, null, null);
        return runTest(p, new ConnectionSecrets(r.password(), r.useUri() ? r.uri() : null));
    }

    private TestResult runTest(ConnectionProfile p, ConnectionSecrets secrets) {
        validateStored(p);
        try {
            Probe probe = adapterFor(p).probe(p, secrets);
            return new TestResult(true, probe.latencyMs(), probe.serverVersion(), "Connection successful");
        } catch (Exception e) {
            return new TestResult(false, 0, null, Errors.root(e));
        }
    }

    public StatusView connect(long id, String accessPassword) {
        ConnectionProfile p = authorised(id, accessPassword);
        validateStored(p);
        LiveConnection live;
        try {
            live = adapterFor(p).open(p, secretsOf(p));
        } catch (ApiException e) {
            audit.record("CONNECT", p, null, null, null, "FAILED", e.getMessage());
            throw e;
        } catch (Exception e) {
            String msg = "Could not connect: " + Errors.root(e);
            audit.record("CONNECT", p, null, null, null, "FAILED", msg);
            throw ApiException.badRequest(msg);
        }
        registry.register(live); // replaces this connection's older copy only; others stay connected
        audit.record("CONNECT", p, null, null, null, "SUCCESS", p.dbType().name());
        return statusOf(live);
    }

    public StatusView disconnect(long id) {
        ConnectionProfile p = get(id);
        registry.disconnect(id);
        audit.record("DISCONNECT", p, null, null, null, "SUCCESS", null);
        return status();
    }

    /** Closes every connection of this browser session. */
    public StatusView disconnectAll() {
        for (LiveConnection c : registry.all()) audit.record("DISCONNECT", c.profile(), null, null, null, "SUCCESS", null);
        registry.disconnectAllInSession();
        return status();
    }

    public StatusView activate(long id) {
        registry.activate(id);
        return registry.get(id).map(this::statusOf).orElseGet(this::status);
    }

    // ------------------------------------------------------------------ status

    /** Health of the active MySQL connection (the one queries and workflows run on). */
    public StatusView status() {
        return registry.active(DbType.MYSQL).map(this::statusOf).orElseGet(() -> new StatusView(false, null, null, null, null, null, null, "Not connected"));
    }

    /** Independent health of every live connection of this session; one failing never affects another. */
    public List<StatusView> statuses() {
        List<StatusView> out = new ArrayList<>();
        for (LiveConnection c : registry.all()) out.add(statusOf(c));
        return out;
    }

    private StatusView statusOf(LiveConnection c) {
        ConnectionProfile p = c.profile();
        boolean active = registry.isActive(p.id());
        try {
            long ms = c.ping();
            return new StatusView(true, p.id(), p.name(), p.environment(), p.host(), p.databaseName(), ms, "Connected", p.dbType().name(), active);
        } catch (Exception e) {
            return new StatusView(false, p.id(), p.name(), p.environment(), p.host(), p.databaseName(), null,
                    "Connection lost: " + Errors.root(e), p.dbType().name(), active);
        }
    }

    // ------------------------------------------------------------------ MySQL database switching

    private MySqlLive activeMySql() {
        return registry.active(DbType.MYSQL).map(c -> (MySqlLive) c)
                .orElseThrow(() -> ApiException.conflict("Not connected. Connect to a MySQL profile first."));
    }

    /** Databases visible to the active MySQL connection's user (system schemas hidden) plus the one currently selected. */
    public DatabaseList databases() {
        MySqlLive live = activeMySql();
        List<String> names = new JdbcTemplate(live.dataSource()).queryForList("SHOW DATABASES", String.class).stream()
                .filter(n -> !SYSTEM_SCHEMAS.contains(n.toLowerCase(Locale.ROOT))).sorted(String.CASE_INSENSITIVE_ORDER).toList();
        return new DatabaseList(names, live.profile().databaseName());
    }

    public StatusView useDatabase(String name) {
        MySqlLive live = activeMySql();
        ConnectionProfile p = live.profile();
        if (!databases().databases().contains(name)) throw ApiException.badRequest("Database '" + name + "' is not visible to this user");
        policy.validate(p.environment(), p.host(), p.port(), name);
        try {
            live.switchDatabase(name);
        } catch (RuntimeException e) {
            audit.record("SWITCH_DATABASE", p, null, null, null, "FAILED", e.getMessage());
            throw ApiException.badRequest("Could not switch database: " + Errors.root(e));
        }
        audit.record("SWITCH_DATABASE", live.profile(), null, null, null, "SUCCESS", null);
        return statusOf(live);
    }

    // ------------------------------------------------------------------ internals

    private ConnectionProfile get(long id) {
        return repo.findById(id).orElseThrow(() -> ApiException.notFound("Connection profile not found"));
    }

    /** The profile, but only if the supplied access password is right. */
    private ConnectionProfile authorised(long id, String accessPassword) {
        ConnectionProfile p = get(id);
        access.verify(id, p.accessPasswordHash(), accessPassword);
        return p;
    }

    private DbAdapter adapterFor(ConnectionProfile p) {
        DbAdapter a = adapters.get(p.dbType());
        if (a == null) throw ApiException.badRequest("Unsupported database type " + p.dbType());
        return a;
    }

    private ConnectionSecrets secretsOf(ConnectionProfile p) {
        try {
            return new ConnectionSecrets(p.passwordEncrypted() == null ? null : crypto.decrypt(p.passwordEncrypted()),
                    p.uriEncrypted() == null ? null : crypto.decrypt(p.uriEncrypted()));
        } catch (IllegalStateException e) {
            throw ApiException.badRequest(e.getMessage());
        }
    }

    private void validateStored(ConnectionProfile p) {
        policy.validate(p.environment(), p.host(), p.port(), p.databaseName());
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private ConnectionView view(ConnectionProfile p) {
        return new ConnectionView(p.id(), p.name(), p.environment(), p.dbType().name(), p.host(), p.port(), p.databaseName(), p.username(),
                p.authDatabase(), p.tls(), p.uriEncrypted() != null, p.ownerName(), p.passwordProtected(),
                registry.get(p.id()).isPresent(), registry.isActive(p.id()));
    }

    /** Validates the request against the approved-environment / no-production policy and builds the profile (secrets encrypted). */
    private ConnectionProfile build(Long id, ConnectionRequest r, DbType type, ConnectionProfile old, String accessHash) {
        String env = policy.normaliseEnvironment(r.environment());
        String name = r.name().trim();
        String owner = blank(r.ownerName()) ? (old == null ? null : old.ownerName()) : r.ownerName().trim();
        if (type == DbType.MYSQL) {
            if (blank(r.host()) || blank(r.databaseName()) || blank(r.username())) throw ApiException.badRequest("Host, database name and username are required");
            int port = r.port() == 0 ? 3306 : r.port();
            policy.validate(env, r.host().trim(), port, r.databaseName().trim());
            String pw;
            if (blank(r.password())) {
                if (old == null || old.passwordEncrypted() == null) throw ApiException.badRequest("Password is required");
                pw = old.passwordEncrypted();
            } else {
                pw = crypto.encrypt(r.password());
            }
            return new ConnectionProfile(id, name, env, r.host().trim(), port, r.databaseName().trim(), r.username(), pw, DbType.MYSQL, owner, accessHash, null, null, false);
        }
        // MongoDB
        if (r.useUri()) {
            String uri = blank(r.uri()) ? null : r.uri().trim();
            String uriEnc;
            if (uri == null) {
                if (old == null || old.uriEncrypted() == null) throw ApiException.badRequest("A MongoDB connection string is required");
                uri = crypto.decrypt(old.uriEncrypted());
                uriEnc = old.uriEncrypted();
            } else {
                uriEnc = crypto.encrypt(uri);
            }
            ConnectionString cs = parseUri(uri);
            String db = blank(r.databaseName()) ? cs.getDatabase() : r.databaseName().trim();
            if (blank(db)) throw ApiException.badRequest("Database name is required (put it in the connection string or the Database name field)");
            String firstHost = null;
            int firstPort = 27017;
            for (String h : cs.getHosts()) {
                String host = h;
                int port = 27017;
                int colon = h.lastIndexOf(':');
                if (colon > 0 && h.indexOf(']') < colon) {
                    host = h.substring(0, colon);
                    try {
                        port = Integer.parseInt(h.substring(colon + 1));
                    } catch (NumberFormatException e) {
                        throw ApiException.badRequest("Invalid port in the connection string");
                    }
                }
                policy.validate(env, host, port, db);
                if (firstHost == null) {
                    firstHost = host;
                    firstPort = port;
                }
            }
            boolean tls = r.tls() || cs.getSslEnabled() != null && cs.getSslEnabled() || uri.toLowerCase(Locale.ROOT).startsWith("mongodb+srv://");
            return new ConnectionProfile(id, name, env, firstHost, firstPort, db, cs.getUsername(), null, DbType.MONGODB, owner, accessHash, uriEnc,
                    blank(r.authDatabase()) ? null : r.authDatabase().trim(), tls);
        }
        if (blank(r.host()) || blank(r.databaseName())) throw ApiException.badRequest("Host and database name are required");
        int port = r.port() == 0 ? 27017 : r.port();
        policy.validate(env, r.host().trim(), port, r.databaseName().trim());
        String pw = null;
        if (!blank(r.username())) {
            if (!blank(r.password())) pw = crypto.encrypt(r.password());
            else if (old != null && old.passwordEncrypted() != null) pw = old.passwordEncrypted();
            else throw ApiException.badRequest("Password is required when a username is given");
        }
        return new ConnectionProfile(id, name, env, r.host().trim(), port, r.databaseName().trim(), blank(r.username()) ? null : r.username(), pw,
                DbType.MONGODB, owner, accessHash, null, blank(r.authDatabase()) ? null : r.authDatabase().trim(), r.tls());
    }

    private static ConnectionString parseUri(String uri) {
        String lower = uri.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("mongodb://") && !lower.startsWith("mongodb+srv://")) {
            throw ApiException.badRequest("The connection string must start with mongodb:// or mongodb+srv://");
        }
        if (lower.contains("tlsallowinvalidcertificates=true") || lower.contains("tlsinsecure=true") || lower.contains("tlsallowinvalidhostnames=true")
                || lower.contains("sslinvalidhostnameallowed=true")) {
            throw ApiException.badRequest("Insecure TLS options (tlsInsecure, tlsAllowInvalidCertificates, tlsAllowInvalidHostnames) are not allowed");
        }
        try {
            return new ConnectionString(uri);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Invalid MongoDB connection string. Expected mongodb://host:port/database or mongodb+srv://host/database");
        }
    }
}
