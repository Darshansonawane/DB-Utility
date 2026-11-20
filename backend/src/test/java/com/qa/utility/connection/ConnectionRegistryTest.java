package com.qa.utility.connection;

import com.qa.utility.model.ConnectionProfile;
import com.qa.utility.model.DbType;
import com.qa.utility.security.SessionContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicBoolean;

import static org.junit.jupiter.api.Assertions.*;

class ConnectionRegistryTest {
    static final class Fake implements LiveConnection {
        final ConnectionProfile p;
        final AtomicBoolean closed = new AtomicBoolean();
        volatile boolean broken;

        Fake(long id, DbType t) {
            p = new ConnectionProfile(id, "c" + id, "QA", "h", 1, "d", "u", null, t, null, null, null, null, false);
        }

        public ConnectionProfile profile() {
            return p;
        }

        public DbType type() {
            return p.dbType();
        }

        public long ping() throws Exception {
            if (broken) throw new Exception("boom");
            return 1;
        }

        public void close() {
            closed.set(true);
        }
    }

    final ConnectionRegistry registry = new ConnectionRegistry(60);

    @AfterEach
    void clear() {
        SessionContext.clear();
    }

    @Test
    void oneSessionHoldsManyConnectionsOfBothTypesAndEachIsIndependent() {
        SessionContext.set("A");
        Fake m1 = new Fake(1, DbType.MYSQL), m2 = new Fake(2, DbType.MYSQL), m3 = new Fake(3, DbType.MYSQL), g1 = new Fake(4, DbType.MONGODB), g2 = new Fake(5, DbType.MONGODB);
        for (Fake f : new Fake[]{m1, m2, m3, g1, g2}) registry.register(f);
        assertEquals(5, registry.all().size());
        assertEquals(3L, registry.active(DbType.MYSQL).get().profile().id());   // last connected is active
        assertEquals(5L, registry.active(DbType.MONGODB).get().profile().id());
        registry.activate(1);                                                    // switching does not disconnect the others
        assertEquals(1L, registry.active(DbType.MYSQL).get().profile().id());
        assertEquals(5, registry.all().size());
        assertTrue(registry.isActive(1) && !registry.isActive(2));
        registry.disconnect(2);
        assertTrue(m2.closed.get());
        assertFalse(m1.closed.get() || m3.closed.get() || g1.closed.get() || g2.closed.get());
        assertEquals(4, registry.all().size());
    }

    @Test
    void sessionsNeverSeeEachOthersConnections() {
        Fake mine = new Fake(1, DbType.MYSQL);
        SessionContext.set("DARSHAN");
        registry.register(mine);
        SessionContext.set("RAHUL");
        assertTrue(registry.get(1).isEmpty());
        assertTrue(registry.all().isEmpty());
        assertTrue(registry.active(DbType.MYSQL).isEmpty());
        registry.disconnect(1);                      // does nothing to Darshan's connection
        assertFalse(mine.closed.get());
        SessionContext.set("DARSHAN");
        assertTrue(registry.get(1).isPresent());
    }

    @Test
    void reconnectingReplacesOnlyThatConnection() {
        SessionContext.set("A");
        Fake a = new Fake(1, DbType.MYSQL), other = new Fake(2, DbType.MONGODB), again = new Fake(1, DbType.MYSQL);
        registry.register(a);
        registry.register(other);
        registry.register(again);
        assertTrue(a.closed.get());
        assertFalse(other.closed.get() || again.closed.get());
        assertEquals(2, registry.all().size());
    }

    @Test
    void editingOrDeletingOneConnectionClosesItEverywhereAndNothingElse() {
        Fake d1 = new Fake(1, DbType.MYSQL), d2 = new Fake(2, DbType.MYSQL), r1 = new Fake(1, DbType.MYSQL);
        SessionContext.set("D");
        registry.register(d1);
        registry.register(d2);
        SessionContext.set("R");
        registry.register(r1);
        registry.disconnectEverywhere(1);
        assertTrue(d1.closed.get() && r1.closed.get());
        assertFalse(d2.closed.get());
        SessionContext.set("D");
        assertEquals(2L, registry.active(DbType.MYSQL).get().profile().id());
    }

    @Test
    void aBrokenConnectionDoesNotAffectItsNeighbours() throws Exception {
        SessionContext.set("A");
        Fake bad = new Fake(1, DbType.MYSQL), good = new Fake(2, DbType.MONGODB);
        registry.register(bad);
        registry.register(good);
        bad.broken = true;
        assertThrows(Exception.class, () -> registry.get(1).get().ping());
        assertEquals(1, registry.get(2).get().ping());
    }

    @Test
    void backgroundThreadsKeepTheStartingSession() throws Exception {
        SessionContext.set("A");
        registry.register(new Fake(1, DbType.MYSQL));
        String sid = SessionContext.current();
        boolean[] seen = new boolean[1];
        Thread t = new Thread(() -> SessionContext.runAs(sid, () -> seen[0] = registry.active(DbType.MYSQL).isPresent()));
        t.start();
        t.join();
        assertTrue(seen[0]);
        boolean[] without = {true};
        Thread t2 = new Thread(() -> without[0] = registry.active(DbType.MYSQL).isPresent());
        t2.start();
        t2.join();
        assertFalse(without[0]);
    }
}
