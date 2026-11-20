package com.qa.utility.connection;

import com.qa.utility.exception.ApiException;
import com.qa.utility.model.DbType;
import com.qa.utility.security.SessionContext;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Every live connection, keyed by (browser session, saved connection). A session can hold many connections of both types at once;
 * each has its own pool/client, so closing or losing one never touches the others. Per session, one connection per database type is
 * the "active" one that queries and workflows use.
 */
@Component
public class ConnectionRegistry {
    private record Key(String sid, long id) {
    }

    private final Map<Key, LiveConnection> live = new ConcurrentHashMap<>();
    private final Map<String, Map<DbType, Long>> active = new ConcurrentHashMap<>();
    private final Map<String, Instant> seen = new ConcurrentHashMap<>();
    private final Duration idle;

    public ConnectionRegistry(@Value("${qa-utility.session-idle-minutes:480}") long idleMinutes) {
        this.idle = Duration.ofMinutes(Math.max(1, idleMinutes));
    }

    private static String sid() {
        String s = SessionContext.current();
        if (s == null) throw ApiException.conflict("No browser session. Reload the page and try again.");
        return s;
    }

    /** Registers a freshly opened connection for this session (replacing an older one for the same profile) and makes it active. */
    public synchronized void register(LiveConnection c) {
        String sid = sid();
        long id = c.profile().id();
        LiveConnection old = live.put(new Key(sid, id), c);
        if (old != null) old.close();
        active.computeIfAbsent(sid, k -> new EnumMap<>(DbType.class)).put(c.type(), id);
        seen.put(sid, Instant.now());
    }

    public Optional<LiveConnection> get(long profileId) {
        String sid = SessionContext.current();
        return sid == null ? Optional.empty() : Optional.ofNullable(live.get(new Key(sid, profileId)));
    }

    public List<LiveConnection> all() {
        String sid = SessionContext.current();
        List<LiveConnection> out = new ArrayList<>();
        if (sid == null) return out;
        live.forEach((k, v) -> {
            if (k.sid().equals(sid)) out.add(v);
        });
        return out;
    }

    /** The connection of this type that queries run on for this session, if any. */
    public Optional<LiveConnection> active(DbType type) {
        String sid = SessionContext.current();
        if (sid == null) return Optional.empty();
        seen.put(sid, Instant.now());
        Long id = active.getOrDefault(sid, Map.of()).get(type);
        return id == null ? Optional.empty() : Optional.ofNullable(live.get(new Key(sid, id)));
    }

    public boolean isActive(long profileId) {
        return get(profileId).map(c -> {
            Long id = active.getOrDefault(SessionContext.current(), Map.of()).get(c.type());
            return id != null && id == profileId;
        }).orElse(false);
    }

    public void activate(long profileId) {
        LiveConnection c = get(profileId).orElseThrow(() -> ApiException.conflict("Connect to this connection first."));
        active.computeIfAbsent(sid(), k -> new EnumMap<>(DbType.class)).put(c.type(), profileId);
    }

    public synchronized void disconnect(long profileId) {
        String sid = sid();
        LiveConnection c = live.remove(new Key(sid, profileId));
        if (c != null) c.close();
        Map<DbType, Long> a = active.get(sid);
        if (a != null) a.values().removeIf(v -> v == profileId);
    }

    public synchronized void disconnectAllInSession() {
        for (LiveConnection c : all()) disconnect(c.profile().id());
    }

    /** Used when a connection is edited or deleted: every session's live copy is closed, other connections are untouched. */
    public synchronized void disconnectEverywhere(long profileId) {
        live.entrySet().removeIf(e -> {
            if (e.getKey().id() != profileId) return false;
            e.getValue().close();
            Map<DbType, Long> a = active.get(e.getKey().sid());
            if (a != null) a.values().removeIf(v -> v == profileId);
            return true;
        });
    }

    @Scheduled(fixedDelay = 60_000)
    synchronized void evictIdleSessions() {
        Instant cutoff = Instant.now().minus(idle);
        seen.entrySet().removeIf(e -> {
            if (!e.getValue().isBefore(cutoff)) return false;
            live.entrySet().removeIf(l -> {
                if (!l.getKey().sid().equals(e.getKey())) return false;
                l.getValue().close();
                return true;
            });
            active.remove(e.getKey());
            return true;
        });
    }

    @PreDestroy
    void shutdown() {
        live.values().forEach(LiveConnection::close);
        live.clear();
    }
}
