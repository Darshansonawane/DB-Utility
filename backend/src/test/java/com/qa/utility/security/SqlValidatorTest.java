package com.qa.utility.security;

import com.qa.utility.exception.ApiException;
import com.qa.utility.security.SqlValidator.StatementType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SqlValidatorTest {
    private final SqlValidator v = new SqlValidator();

    @Test
    void acceptsSelectWithCommentsAndTrailingSemicolon() {
        var p = v.validate("-- schedule data\nSELECT sws.* FROM bank_wallet.savings_wallet_schedule AS sws WHERE customer_id = ? ORDER BY sws.id DESC;");
        assertEquals(StatementType.SELECT, p.type());
        assertEquals(1, p.placeholders());
        assertFalse(p.sql().contains("--"));
        assertFalse(p.sql().endsWith(";"));
    }

    @Test
    void classifiesWrites() {
        assertEquals(StatementType.UPDATE, v.validate("UPDATE t SET a = ? WHERE b = ?").type());
        assertEquals(StatementType.DELETE, v.validate("DELETE FROM t WHERE id = ?").type());
        assertEquals(StatementType.INSERT, v.validate("INSERT INTO t (a) VALUES (?)").type());
    }

    @Test
    void rejectsMultipleStatements() {
        assertThrows(ApiException.class, () -> v.validate("SELECT 1; DROP TABLE users"));
        assertThrows(ApiException.class, () -> v.validate("SELECT 1; SELECT 2"));
    }

    @Test
    void semicolonInsideStringIsFine() {
        assertEquals(0, v.validate("SELECT * FROM t WHERE a = 'x;y'").placeholders());
    }

    @Test
    void questionMarkInsideStringIsNotAPlaceholder() {
        assertEquals(1, v.validate("SELECT * FROM t WHERE a = 'what?' AND b = ?").placeholders());
    }

    @Test
    void rejectsDdlAndOtherStatements() {
        for (String s : new String[]{"DROP TABLE t", "TRUNCATE TABLE t", "ALTER TABLE t ADD c INT", "CREATE TABLE x (a INT)",
                "GRANT ALL ON *.* TO 'a'", "CALL proc()", "REPLACE INTO t VALUES (1)", "SET @a = 1"}) {
            assertThrows(ApiException.class, () -> v.validate(s), s);
        }
    }

    @Test
    void rejectsUpdateAndDeleteWithoutWhere() {
        assertThrows(ApiException.class, () -> v.validate("UPDATE t SET a = 1"));
        assertThrows(ApiException.class, () -> v.validate("DELETE FROM t"));
        // WHERE only inside a subquery does not count
        assertThrows(ApiException.class, () -> v.validate("UPDATE t SET a = (SELECT 1 FROM x WHERE x.id = 1)"));
        assertThrows(ApiException.class, () -> v.validate("UPDATE t SET note = 'where' "));
    }

    @Test
    void rejectsDangerousConstructs() {
        assertThrows(ApiException.class, () -> v.validate("SELECT * FROM t INTO OUTFILE '/tmp/x'"));
        assertThrows(ApiException.class, () -> v.validate("SELECT LOAD_FILE('/etc/passwd')"));
        assertThrows(ApiException.class, () -> v.validate("SELECT SLEEP(100)"));
        assertThrows(ApiException.class, () -> v.validate("SELECT * FROM t WHERE a = 1 FOR UPDATE"));
        assertThrows(ApiException.class, () -> v.validate("SELECT /*! 1 */ 1"));
        assertThrows(ApiException.class, () -> v.validate("WITH x AS (SELECT 1) DELETE FROM t WHERE a = 1"));
    }

    @Test
    void commentTrickCannotHideSecondStatement() {
        assertThrows(ApiException.class, () -> v.validate("SELECT 1 /* ; */ ; DELETE FROM t WHERE 1=1"));
        // hash comment hides nothing: comment is stripped, remainder is one SELECT
        assertEquals(StatementType.SELECT, v.validate("SELECT 1 # ; DROP TABLE t").type());
    }

    @Test
    void emptyAndUnterminatedRejected() {
        assertThrows(ApiException.class, () -> v.validate("   "));
        assertThrows(ApiException.class, () -> v.validate("SELECT 'abc"));
        assertThrows(ApiException.class, () -> v.validate("-- only a comment"));
    }
}
