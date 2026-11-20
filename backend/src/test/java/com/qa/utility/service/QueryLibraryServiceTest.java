package com.qa.utility.service;

import com.qa.utility.dto.SqlDtos.SqlAnalysis;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.*;
import com.qa.utility.support.AbstractDbTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class QueryLibraryServiceTest extends AbstractDbTest {
    @Autowired
    QueryLibraryService library;

    private SavedQuery q(String name, String sql, QueryType type, QueryParameter... params) {
        return new SavedQuery(null, name + UUID.randomUUID(), "d", "Test", sql, type, List.of(), true, List.of(params));
    }

    private static QueryParameter p(String name, ParamType t) {
        return new QueryParameter(name, name, t, true, null);
    }

    @Test
    void createDuplicateDisableDeleteAndSearch() {
        SavedQuery created = library.create(q("Find tx", "SELECT * FROM employee_transaction WHERE hr_id = ?", QueryType.READ, p("hr_id", ParamType.STRING)));
        assertNotNull(created.id());
        assertEquals(1, library.search(created.name().substring(0, 7), null).size() >= 1 ? 1 : 0);
        SavedQuery copy = library.duplicate(created.id());
        assertTrue(copy.name().contains("(copy)"));
        assertFalse(library.setEnabled(created.id(), false).enabled());
        assertThrows(ApiException.class, () -> library.execute(created.id(), Map.of("hr_id", "HR1"), null));
        library.delete(copy.id());
        assertThrows(ApiException.class, () -> library.get(copy.id()));
    }

    @Test
    void executesSavedQueryUsingGeneratedParameterValues() {
        SavedQuery c = library.create(q("By HR", "SELECT * FROM employee_transaction WHERE hr_id = ? AND transaction_date >= ?", QueryType.READ,
                p("hr_id", ParamType.STRING), p("from_date", ParamType.DATE)));
        var r = library.execute(c.id(), Map.of("hr_id", "HR1", "from_date", "2024-01-02"), null);
        assertEquals(1, r.rowCount());
    }

    @Test
    void parameterCountAndClassificationAreEnforced() {
        assertThrows(ApiException.class, () -> library.create(q("bad", "SELECT * FROM employee_transaction WHERE hr_id = ?", QueryType.READ)));
        assertThrows(ApiException.class, () -> library.create(q("bad", "UPDATE employee_transaction SET hr_id = ? WHERE id = ?", QueryType.READ,
                p("a", ParamType.STRING), p("b", ParamType.INTEGER))));
        assertThrows(ApiException.class, () -> library.create(q("bad", "DROP TABLE employee_transaction", QueryType.WRITE)));
        assertThrows(ApiException.class, () -> library.create(q("dup", "SELECT ?, ?", QueryType.READ, p("a", ParamType.STRING), p("A", ParamType.STRING))));
    }

    @Test
    void missingOrInvalidValuesRejected() {
        SavedQuery c = library.create(q("req", "SELECT * FROM employee_transaction WHERE id = ?", QueryType.READ, p("id", ParamType.INTEGER)));
        assertThrows(ApiException.class, () -> library.execute(c.id(), Map.of(), null));
        assertThrows(ApiException.class, () -> library.execute(c.id(), Map.of("id", "x"), null));
    }

    @Test
    void environmentRestrictionIsEnforced() {
        SavedQuery c = library.create(new SavedQuery(null, "uat-only" + UUID.randomUUID(), "", "Test", "SELECT 1", QueryType.READ, List.of("UAT"), true, List.of()));
        ApiException e = assertThrows(ApiException.class, () -> library.execute(c.id(), Map.of(), null)); // test connection is QA
        assertTrue(e.getMessage().contains("restricted"));
    }

    @Test
    void savedWriteQueryGoesThroughPreviewAndConfirmation() {
        allowWrites();
        SavedQuery c = library.create(q("upd", "UPDATE employee_transaction SET transaction_date = ? WHERE hr_id = ? AND transaction_id = ?", QueryType.WRITE,
                p("transaction_date", ParamType.DATE), p("hr_id", ParamType.STRING), p("transaction_id", ParamType.STRING)));
        Map<String, String> v = Map.of("transaction_date", "2025-03-03", "hr_id", "HR1", "transaction_id", "T2");
        assertThrows(ApiException.class, () -> library.execute(c.id(), v, null));
        var pv = library.preview(c.id(), v);
        assertEquals(1L, pv.affectedRows());
        assertEquals(1, library.execute(c.id(), v, pv.confirmationToken()).affectedRows());
    }

    @Test
    void analyzeSuggestsDynamicFormFields() {
        SqlAnalysis a = library.analyze("UPDATE savings_wallet_contributions SET contribution_date = ? WHERE contributor_id = ?");
        assertTrue(a.write());
        assertEquals(2, a.suggestedParameters().size());
        assertEquals("contribution_date", a.suggestedParameters().get(0).name());
        assertEquals("Contribution Date", a.suggestedParameters().get(0).label());
        assertEquals(ParamType.DATE, a.suggestedParameters().get(0).type());
        assertEquals("Contributor ID", a.suggestedParameters().get(1).label());
        assertEquals(ParamType.STRING, a.suggestedParameters().get(1).type());
    }
}
