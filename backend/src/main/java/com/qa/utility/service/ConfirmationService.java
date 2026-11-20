package com.qa.utility.service;

import com.qa.utility.config.AppProperties;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.BoundParam;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Issues single-use, short-lived confirmation tokens bound to the exact SQL + parameter values + connection that
 * were previewed. A write can only run with a token whose fingerprint still matches.
 */
@Service
public class ConfirmationService {
    private record Pending(String fingerprint, Instant expires) {
    }

    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final AppProperties props;

    public ConfirmationService(AppProperties props) {
        this.props = props;
    }

    public String issue(String sql, List<BoundParam> params, Long connectionId) {
        Instant now = Instant.now();
        pending.values().removeIf(p -> p.expires().isBefore(now));
        String token = UUID.randomUUID().toString();
        pending.put(token, new Pending(fingerprint(sql, params, connectionId), now.plusSeconds(props.confirmationTtlSeconds())));
        return token;
    }

    public void consume(String token, String sql, List<BoundParam> params, Long connectionId) {
        Pending p = token == null ? null : pending.remove(token);
        if (p == null || p.expires().isBefore(Instant.now())) {
            throw ApiException.forbidden("Write not confirmed: preview the statement and confirm it first (token missing, used or expired).");
        }
        if (!p.fingerprint().equals(fingerprint(sql, params, connectionId))) {
            throw ApiException.forbidden("Write rejected: the statement, parameters or connection changed since the preview.");
        }
    }

    static String fingerprint(String sql, List<BoundParam> params, Long connectionId) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(sql.getBytes(StandardCharsets.UTF_8));
            md.update(("|" + connectionId).getBytes(StandardCharsets.UTF_8));
            for (BoundParam p : params) md.update(("|" + p.type() + ":" + p.raw()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(md.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
