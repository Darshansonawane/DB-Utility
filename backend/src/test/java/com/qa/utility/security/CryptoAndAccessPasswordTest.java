package com.qa.utility.security;

import com.qa.utility.config.AppProperties;
import com.qa.utility.exception.ApiException;
import org.junit.jupiter.api.Test;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CryptoAndAccessPasswordTest {
    final AppProperties props = new AppProperties("target/test-data", List.of("QA"), List.of("prod"), List.of(), "unit-test-key", 5000, 100, 120, 20, 300, 50);
    final CryptoService crypto = new CryptoService(props);
    final AccessPasswordService access = new AccessPasswordService();

    @Test
    void envelopeEncryptionUsesAFreshDataKeyPerValueAndRoundTrips() {
        String a = crypto.encrypt("s3cret"), b = crypto.encrypt("s3cret");
        assertNotEquals(a, b);
        assertTrue(a.startsWith("v2:") && a.split(":").length == 3);
        assertEquals("s3cret", crypto.decrypt(a));
        assertFalse(a.contains("s3cret"));
    }

    @Test
    void valuesStoredByTheOlderVersionStillDecrypt() throws Exception {
        byte[] key = MessageDigest.getInstance("SHA-256").digest("unit-test-key".getBytes(StandardCharsets.UTF_8));
        byte[] iv = new byte[12];
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
        byte[] ct = c.doFinal("legacy-pw".getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[12 + ct.length];
        System.arraycopy(iv, 0, all, 0, 12);
        System.arraycopy(ct, 0, all, 12, ct.length);
        assertEquals("legacy-pw", crypto.decrypt(Base64.getEncoder().encodeToString(all)));
    }

    @Test
    void tamperedOrWrongKeyCiphertextIsRejected() {
        String enc = crypto.encrypt("x");
        assertThrows(IllegalStateException.class, () -> crypto.decrypt(enc.substring(0, enc.length() - 4) + "AAAA"));
        CryptoService other = new CryptoService(new AppProperties("target/test-data", List.of("QA"), List.of("prod"), List.of(), "another-key", 5000, 100, 120, 20, 300, 50));
        assertThrows(IllegalStateException.class, () -> other.decrypt(enc));
    }

    @Test
    void accessPasswordIsSaltedHashedAndVerified() {
        String h1 = access.hash("open-sesame"), h2 = access.hash("open-sesame");
        assertNotEquals(h1, h2);
        assertFalse(h1.contains("open-sesame"));
        assertTrue(access.matches("open-sesame", h1));
        assertFalse(access.matches("Open-sesame", h1));
        assertFalse(access.matches(null, h1));
        assertThrows(ApiException.class, () -> access.hash("123"));
    }
}
