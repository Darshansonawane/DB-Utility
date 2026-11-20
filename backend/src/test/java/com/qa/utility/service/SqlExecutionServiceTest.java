package com.qa.utility.service;

import com.qa.utility.dto.SqlDtos.QueryResult;
import com.qa.utility.dto.SqlDtos.WritePreview;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.AppSettings;
import com.qa.utility.model.BoundParam;
import com.qa.utility.model.ParamType;
import com.qa.utility.service.SqlExecutionService.ExecContext;
import com.qa.utility.support.AbstractDbTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class SqlExecutionServiceTest extends AbstractDbTest {
    @Autowired
    SqlExecutionService sql;
    @Autowired
    JdbcTemplate meta;

    private static BoundParam s(String v) {
        return new BoundParam(ParamType.STRING, v);
    }

    private long count(String where) {
        return db.queryForObject("SELECT COUNT(*) FROM employee_transaction " + where, Long.class);
    }

    @Test
    void selectBindsParameters() {
        QueryResult r = sql.execute("SELECT * FROM employee_transaction WHERE hr_id = ? ORDER BY id", List.of(s("HR1")), null, ExecContext.editor());
        assertEquals(2, r.rowCount());
        assertEquals("ID", r.columns().get(0).name().toUpperCase());
        assertFalse(r.truncated());
    }

    @Test
    void sqlInjectionIsBoundAsLiteralNotExecuted() {
        QueryResult r = sql.execute("SELECT * FROM employee_transaction WHERE hr_id = ?",
                List.of(s("HR1' OR '1'='1")), null, ExecContext.editor());
        assertEquals(0, r.rowCount());
        r = sql.execute("SELECT * FROM employee_transaction WHERE hr_id = ?", List.of(s("x'; DROP TABLE employee_transaction; --")), null, ExecContext.editor());
        assertEquals(0, r.rowCount());
        assertEquals(3, count(""));
    }

    @Test
    void stackedStatementsAreRejected() {
        assertThrows(ApiException.class, () -> sql.execute("SELECT 1; DROP TABLE employee_transaction", List.of(), null, ExecContext.editor()));
        assertEquals(3, count(""));
    }

    @Test
    void invalidParametersAreRejected() {
        assertThrows(ApiException.class, () -> sql.execute("SELECT * FROM employee_transaction WHERE id = ?",
                List.of(new BoundParam(ParamType.INTEGER, "abc")), null, ExecContext.editor()));
        assertThrows(ApiException.class, () -> sql.execute("SELECT * FROM employee_transaction WHERE id = ?", List.of(), null, ExecContext.editor()));
        assertThrows(ApiException.class, () -> sql.execute("SELECT * FROM employee_transaction WHERE transaction_date = ?",
                List.of(new BoundParam(ParamType.DATE, "not-a-date")), null, ExecContext.editor()));
    }

    @Test
    void sqlErrorsAreReadable() {
        ApiException e = assertThrows(ApiException.class, () -> sql.execute("SELECT * FROM no_such_table", List.of(), null, ExecContext.editor()));
        assertTrue(e.getMessage().startsWith("SQL error"), e.getMessage());
    }

    @Test
    void resultLimitTruncates() {
        settings.update(new AppSettings(true, 2, 30, 10, false, true));
        QueryResult r = sql.execute("SELECT * FROM employee_transaction", List.of(), null, ExecContext.editor());
        assertEquals(2, r.rowCount());
        assertTrue(r.truncated());
    }

    @Test
    void queryTimeoutCancelsLongStatement() {
        settings.update(new AppSettings(true, 500, 1, 10, false, true));
        ApiException e = assertThrows(ApiException.class, () -> sql.execute(
                "SELECT COUNT(*) FROM SYSTEM_RANGE(1, 2000000) a CROSS JOIN SYSTEM_RANGE(1, 2000000) b", List.of(), null, ExecContext.editor()));
        assertTrue(e.getMessage().contains("timeout"), e.getMessage());
    }

    @Test
    void readOnlyModeReturnsBlockedPreviewAndRejectsExecute() {
        List<BoundParam> p = List.of(new BoundParam(ParamType.DATE, "2025-01-01"), s("HR2"));
        String q = "UPDATE employee_transaction SET transaction_date = ? WHERE hr_id = ?";
        WritePreview pv = sql.preview(q, p, ExecContext.saved(1, "q"));
        assertFalse(pv.executable());
        assertNull(pv.confirmationToken());
        assertTrue(pv.blockedReason().contains("Read-only"));
        assertThrows(ApiException.class, () -> sql.execute(q, p, "whatever", ExecContext.saved(1, "q")));
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM employee_transaction WHERE transaction_date = DATE '2025-01-01'", Long.class));
    }

    @Test
    void updateRequiresPreviewThenConfirmationAndIsAudited() {
        allowWrites();
        String q = "UPDATE employee_transaction SET transaction_date = ? WHERE hr_id = ? AND transaction_id = ?";
        List<BoundParam> p = List.of(new BoundParam(ParamType.DATE, "2025-01-01"), s("HR1"), s("T1"));
        // no token -> rejected
        assertThrows(ApiException.class, () -> sql.execute(q, p, null, ExecContext.saved(1, "q")));

        WritePreview pv = sql.preview(q, p, ExecContext.saved(1, "q"));
        assertTrue(pv.executable());
        assertTrue(pv.previewDerived());
        assertEquals(1L, pv.affectedRows());
        assertEquals(1, pv.targetRows().size());
        assertEquals("transaction_date", pv.proposedChanges().get(0).column());
        assertEquals("2025-01-01", pv.proposedChanges().get(0).newValue());
        // preview did not change anything
        assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM employee_transaction WHERE transaction_date = DATE '2025-01-01'", Long.class));

        // token bound to exact params: changed value is rejected
        List<BoundParam> tampered = List.of(new BoundParam(ParamType.DATE, "2030-01-01"), s("HR1"), s("T1"));
        assertThrows(ApiException.class, () -> sql.execute(q, tampered, pv.confirmationToken(), ExecContext.saved(1, "q")));
        // token is single use and the failed attempt consumed it: preview again
        WritePreview pv2 = sql.preview(q, p, ExecContext.saved(1, "q"));
        QueryResult r = sql.execute(q, p, pv2.confirmationToken(), ExecContext.saved(1, "q"));
        assertEquals(1, r.affectedRows());
        assertEquals(1, db.queryForObject("SELECT COUNT(*) FROM employee_transaction WHERE transaction_date = DATE '2025-01-01'", Long.class));
        // replay rejected
        assertThrows(ApiException.class, () -> sql.execute(q, p, pv2.confirmationToken(), ExecContext.saved(1, "q")));

        Long audited = meta.queryForObject("SELECT COUNT(*) FROM audit_log WHERE action = 'WRITE_EXECUTE' AND rows_affected = 1 AND sql_text LIKE 'UPDATE employee_transaction%'", Long.class);
        assertTrue(audited >= 1);
        // audit params are masked
        Long masked = meta.queryForObject("SELECT COUNT(*) FROM audit_log WHERE action = 'WRITE_EXECUTE' AND params_masked LIKE '%HR1%'", Long.class);
        assertEquals(0, masked);
    }

    @Test
    void affectedRowLimitBlocksPreviewAndRollsBackExecution() {
        settings.update(new AppSettings(false, 500, 30, 1, true, true));
        String q = "UPDATE employee_transaction SET transaction_date = ? WHERE hr_id = ?";
        List<BoundParam> p = List.of(new BoundParam(ParamType.DATE, "2025-01-01"), s("HR1"));
        WritePreview pv = sql.preview(q, p, ExecContext.saved(1, "q"));
        assertFalse(pv.withinLimit());
        assertFalse(pv.executable());
        assertEquals(2L, pv.affectedRows());
        assertNull(pv.confirmationToken());
    }

    @Test
    void executionRollsBackWhenRowsExceedLimit() {
        allowWrites();
        String q = "DELETE FROM employee_transaction WHERE hr_id = ?";
        List<BoundParam> p = List.of(s("HR1"));
        WritePreview pv = sql.preview(q, p, ExecContext.saved(1, "q"));
        assertEquals(2L, pv.affectedRows());
        String token = pv.confirmationToken();
        // lower the limit after the preview: execution must still enforce it and roll back
        settings.update(new AppSettings(false, 500, 30, 1, true, true));
        ApiException e = assertThrows(ApiException.class, () -> sql.execute(q, p, token, ExecContext.saved(1, "q")));
        assertTrue(e.getMessage().contains("Rolled back"));
        assertEquals(3, count(""));
    }

    @Test
    void deleteSafeguards() {
        allowWrites();
        assertThrows(ApiException.class, () -> sql.preview("DELETE FROM employee_transaction", List.of(), ExecContext.saved(1, "q")));
        assertThrows(ApiException.class, () -> sql.execute("DELETE FROM employee_transaction", List.of(), "tok", ExecContext.saved(1, "q")));
        // ad-hoc editor writes are disabled by default even when read-only is off
        settings.update(new AppSettings(false, 500, 30, 10, false, true));
        WritePreview pv = sql.preview("DELETE FROM employee_transaction WHERE id = ?", List.of(new BoundParam(ParamType.INTEGER, "3")), ExecContext.editor());
        assertFalse(pv.executable());
        assertTrue(pv.blockedReason().contains("Ad-hoc writes"));
        assertEquals(3, count(""));
        // allowed path: confirmed delete of exactly one row
        allowWrites();
        WritePreview ok = sql.preview("DELETE FROM employee_transaction WHERE id = ?", List.of(new BoundParam(ParamType.INTEGER, "3")), ExecContext.editor());
        assertTrue(ok.executable());
        assertEquals(1, sql.execute("DELETE FROM employee_transaction WHERE id = ?", List.of(new BoundParam(ParamType.INTEGER, "3")), ok.confirmationToken(), ExecContext.editor()).affectedRows());
        assertEquals(2, count(""));
    }

    @Test
    void insertRunsOnlyAfterConfirmation() {
        allowWrites();
        String q = "INSERT INTO employee_transaction (id, hr_id, transaction_id, transaction_date) VALUES (?, ?, ?, ?)";
        List<BoundParam> p = List.of(new BoundParam(ParamType.INTEGER, "10"), s("HR9"), s("T9"), new BoundParam(ParamType.DATE, "2025-02-02"));
        assertThrows(ApiException.class, () -> sql.execute(q, p, null, ExecContext.editor()));
        WritePreview pv = sql.preview(q, p, ExecContext.editor());
        assertTrue(pv.executable());
        assertNull(pv.affectedRows());
        assertEquals(1, sql.execute(q, p, pv.confirmationToken(), ExecContext.editor()).affectedRows());
        assertEquals(4, count(""));
    }

    @Test
    void executionHistoryRecordsSuccessAndFailure() {
        long before = meta.queryForObject("SELECT COUNT(*) FROM execution_history", Long.class);
        sql.execute("SELECT 1", List.of(), null, ExecContext.editor());
        assertThrows(ApiException.class, () -> sql.execute("SELECT * FROM missing_table", List.of(), null, ExecContext.editor()));
        assertEquals(before + 2, meta.queryForObject("SELECT COUNT(*) FROM execution_history", Long.class));
        assertEquals("FAILED", meta.queryForObject("SELECT status FROM execution_history ORDER BY id DESC LIMIT 1", String.class));
    }
}
