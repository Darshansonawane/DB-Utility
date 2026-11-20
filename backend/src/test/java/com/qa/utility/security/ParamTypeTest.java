package com.qa.utility.security;

import com.qa.utility.exception.ApiException;
import com.qa.utility.model.ParamType;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

class ParamTypeTest {
    @Test
    void convertsValidValues() {
        assertEquals(42L, ParamType.INTEGER.convert("42", "n"));
        assertEquals(new BigDecimal("12.50"), ParamType.DECIMAL.convert("12.50", "n"));
        assertEquals(java.sql.Date.valueOf("2024-05-06"), ParamType.DATE.convert("2024-05-06", "d"));
        assertEquals(java.sql.Timestamp.valueOf("2024-05-06 10:11:12"), ParamType.DATETIME.convert("2024-05-06T10:11:12", "d"));
        assertEquals(true, ParamType.BOOLEAN.convert("true", "b"));
        assertEquals("x' OR 1=1 --", ParamType.STRING.convert("x' OR 1=1 --", "s"));
    }

    @Test
    void rejectsInvalidValues() {
        assertThrows(ApiException.class, () -> ParamType.INTEGER.convert("12abc", "Amount"));
        assertThrows(ApiException.class, () -> ParamType.DATE.convert("31/12/2024", "Date"));
        assertThrows(ApiException.class, () -> ParamType.BOOLEAN.convert("maybe", "Flag"));
        assertThrows(ApiException.class, () -> ParamType.DECIMAL.convert("1,5", "Amt"));
    }
}
