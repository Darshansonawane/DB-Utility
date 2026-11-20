package com.qa.utility.security;

import com.qa.utility.config.AppProperties;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** AES-256-GCM encryption for stored DB passwords. Key comes from QA_UTILITY_MASTER_KEY or a 0600 key file. */
@Service
public class CryptoService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final SecretKeySpec key;

    public CryptoService(AppProperties props) {
        try {
            byte[] keyBytes;
            if (props.masterKey() != null && !props.masterKey().isBlank()) {
                keyBytes = MessageDigest.getInstance("SHA-256").digest(props.masterKey().getBytes(StandardCharsets.UTF_8));
            } else {
                Path dir = Path.of(props.dataDir());
                Files.createDirectories(dir);
                Path file = dir.resolve("master.key");
                if (!Files.exists(file)) {
                    byte[] fresh = new byte[32];
                    RANDOM.nextBytes(fresh);
                    Files.writeString(file, Base64.getEncoder().encodeToString(fresh));
                    try {
                        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------"));
                    } catch (UnsupportedOperationException ignored) {
                        // non-POSIX file system
                    }
                }
                keyBytes = Base64.getDecoder().decode(Files.readString(file).trim());
            }
            this.key = new SecretKeySpec(keyBytes, "AES");
        } catch (IOException | java.security.GeneralSecurityException e) {
            throw new IllegalStateException("Unable to initialise encryption key", e);
        }
    }

    public String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("Encryption failed", e);
        }
    }

    public String decrypt(String encoded) {
        try {
            byte[] all = Base64.getDecoder().decode(encoded);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, all, 0, 12));
            return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException("Stored password cannot be decrypted with the current master key", e);
        }
    }
}
