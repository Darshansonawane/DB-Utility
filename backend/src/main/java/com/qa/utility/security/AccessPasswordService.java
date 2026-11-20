package com.qa.utility.security;

import com.qa.utility.exception.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The per-connection access password: chosen when a connection is created and required to connect to, test, edit or delete it.
 * Only a salted PBKDF2 hash is stored. Repeated wrong guesses lock that connection for a minute.
 */
@Service
public class AccessPasswordService {
    public static final int MIN_LENGTH = 6;
    private static final int ITERATIONS = 210_000;
    private static final int MAX_FAILURES = 5;
    private static final long LOCK_SECONDS = 60;
    private static final SecureRandom RANDOM = new SecureRandom();

    private static final class Attempts {
        int failures;
        Instant lockedUntil = Instant.EPOCH;
    }

    private final Map<Long, Attempts> attempts = new ConcurrentHashMap<>();

    public String hash(String password) {
        if (password == null || password.length() < MIN_LENGTH) {
            throw ApiException.badRequest("The access password must be at least " + MIN_LENGTH + " characters");
        }
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return "pbkdf2$" + ITERATIONS + "$" + Base64.getEncoder().encodeToString(salt) + "$" + Base64.getEncoder().encodeToString(derive(password, salt, ITERATIONS));
    }

    public boolean matches(String password, String stored) {
        if (password == null || stored == null) return false;
        String[] p = stored.split("\\$");
        if (p.length != 4 || !p[0].equals("pbkdf2")) return false;
        byte[] expected = Base64.getDecoder().decode(p[3]);
        byte[] actual = derive(password, Base64.getDecoder().decode(p[2]), Integer.parseInt(p[1]));
        return MessageDigest.isEqual(expected, actual);
    }

    /** Throws unless {@code password} matches the connection's stored hash. Never says whether the connection exists or what the hash is. */
    public void verify(long profileId, String storedHash, String password) {
        if (storedHash == null || storedHash.isBlank()) {
            throw new ApiException(HttpStatus.PRECONDITION_REQUIRED, "This connection has no access password yet. Set one before using it.");
        }
        Attempts a = attempts.computeIfAbsent(profileId, k -> new Attempts());
        synchronized (a) {
            if (Instant.now().isBefore(a.lockedUntil)) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "Too many wrong access passwords. Try again in a minute.");
            }
            if (matches(password, storedHash)) {
                a.failures = 0;
                return;
            }
            if (++a.failures >= MAX_FAILURES) {
                a.failures = 0;
                a.lockedUntil = Instant.now().plusSeconds(LOCK_SECONDS);
            }
        }
        throw ApiException.forbidden("Incorrect access password for this connection.");
    }

    public void forget(long profileId) {
        attempts.remove(profileId);
    }

    private static byte[] derive(String password, byte[] salt, int iterations) {
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(new PBEKeySpec(password.toCharArray(), salt, iterations, 256)).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
