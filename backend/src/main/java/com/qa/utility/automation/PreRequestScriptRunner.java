package com.qa.utility.automation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.qa.utility.automation.ApiDtos.Header;
import com.qa.utility.exception.ApiException;
import org.mozilla.javascript.BaseFunction;
import org.mozilla.javascript.Callable;
import org.mozilla.javascript.Context;
import org.mozilla.javascript.ContextFactory;
import org.mozilla.javascript.RhinoException;
import org.mozilla.javascript.Scriptable;
import org.mozilla.javascript.ScriptableObject;
import org.mozilla.javascript.Undefined;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * Runs a request's pre-request JavaScript in a locked-down Rhino sandbox. The script can read and change the request
 * (url, method, headers, body), read and set variables and use a few helpers. It has no access to Java classes, files or the
 * network, and is stopped after a few seconds.
 */
@Service
public class PreRequestScriptRunner {
    public record Result(String method, String url, List<Header> headers, String body, List<String> log) {
    }

    static final class ScriptTimeout extends Error {
        ScriptTimeout() {
            super("timeout", null, false, false);
        }
    }

    private static final long MAX_MILLIS = 3000;
    private static final int MAX_LOG_LINES = 200;
    private static final ContextFactory FACTORY = new ContextFactory() {
        @Override
        protected Context makeContext() {
            Context cx = super.makeContext();
            cx.setInstructionObserverThreshold(10_000);
            return cx;
        }

        @Override
        protected void observeInstructionCount(Context cx, int instructionCount) {
            Long deadline = (Long) cx.getThreadLocal("deadline");
            if (deadline != null && System.currentTimeMillis() > deadline) throw new ScriptTimeout();
        }
    };

    private static final String PRELUDE = """
            var request = JSON.parse(__requestJson);
            var console = { log: function () { __log(Array.prototype.slice.call(arguments).map(function (a) {
                return (a !== null && typeof a === 'object') ? JSON.stringify(a) : String(a); }).join(' ')); } };
            var vars = {
              get: function (n) { var v = __get(String(n)); return v === undefined ? null : v; },
              has: function (n) { return __get(String(n)) !== undefined; },
              set: function (n, v, secret) { __set(String(n), v === null || v === undefined ? '' : String(v), !!secret); return v; }
            };
            var uuid = function () { return __uuid(); };
            var timestamp = function () { return Date.now(); };
            var isoDate = function (offsetDays) { return __isoDate(offsetDays || 0); };
            var isoDateTime = function (offsetDays) { return __isoDateTime(offsetDays || 0); };
            var randomInt = function (min, max) { min = Math.ceil(min); max = Math.floor(max); return Math.floor(Math.random() * (max - min + 1)) + min; };
            var randomString = function (len) { var c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', s = ''; for (var i = 0; i < (len || 8); i++) s += c.charAt(Math.floor(Math.random() * c.length)); return s; };
            var randomNumeric = function (len) { var s = ''; for (var i = 0; i < (len || 8); i++) s += Math.floor(Math.random() * 10); return s; };
            var pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
            var base64 = function (s) { return __b64(String(s)); };
            var base64Decode = function (s) { return __b64d(String(s)); };
            var sha256 = function (s) { return __sha256(String(s)); };
            var hmacSha256 = function (key, s) { return __hmac(String(key), String(s)); };
            function __finish() {
              if (request.body !== null && request.body !== undefined && typeof request.body === 'object') request.body = JSON.stringify(request.body, null, 2);
              return JSON.stringify({ method: request.method, url: request.url, headers: request.headers, body: request.body === undefined ? null : request.body });
            }
            """;

    private final VariableService variables;
    private final ObjectMapper json = new ObjectMapper();

    public PreRequestScriptRunner(VariableService variables) {
        this.variables = variables;
    }

    public Result run(String script, String method, String url, List<Header> headers, String body, VarScope scope) {
        if (script.length() > 20_000) throw ApiException.badRequest("Pre-request script is too long (max 20000 characters)");
        ObjectNode req = json.createObjectNode();
        req.put("method", method);
        req.put("url", url);
        ObjectNode hs = req.putObject("headers");
        for (Header h : headers) if (h.name() != null && !h.name().isBlank()) hs.put(h.name().trim(), h.value() == null ? "" : h.value());
        req.put("body", body);
        List<String> log = new ArrayList<>();
        Context cx = FACTORY.enterContext();
        try {
            cx.setLanguageVersion(Context.VERSION_ES6);
            cx.setOptimizationLevel(-1); // interpreted mode is required for the instruction observer
            cx.setClassShutter(name -> false); // scripts can never reach a Java class
            cx.putThreadLocal("deadline", System.currentTimeMillis() + MAX_MILLIS);
            Scriptable sc = cx.initSafeStandardObjects();
            def(sc, "__requestJson", json.writeValueAsString(req));
            def(sc, "__log", fn(a -> {
                if (log.size() < MAX_LOG_LINES) {
                    String line = Context.toString(arg(a, 0));
                    log.add(line.length() > 2000 ? line.substring(0, 2000) + "…" : line);
                }
                return Undefined.instance;
            }));
            def(sc, "__get", fn(a -> variables.lookup(Context.toString(arg(a, 0)), scope).map(v -> (Object) v).orElse(Undefined.instance)));
            def(sc, "__set", fn(a -> {
                String name = Context.toString(arg(a, 0));
                try {
                    variables.put(name, Context.toString(arg(a, 1)), Context.toBoolean(arg(a, 2)), "script", scope);
                } catch (ApiException e) {
                    throw Context.reportRuntimeError(e.getMessage());
                }
                return Undefined.instance;
            }));
            def(sc, "__uuid", fn(a -> java.util.UUID.randomUUID().toString()));
            def(sc, "__isoDate", fn(a -> LocalDate.now().plusDays((long) Context.toNumber(arg(a, 0))).toString()));
            def(sc, "__isoDateTime", fn(a -> LocalDateTime.now().plusDays((long) Context.toNumber(arg(a, 0))).withNano(0).toString()));
            def(sc, "__b64", fn(a -> Base64.getEncoder().encodeToString(Context.toString(arg(a, 0)).getBytes(StandardCharsets.UTF_8))));
            def(sc, "__b64d", fn(a -> {
                try {
                    return new String(Base64.getDecoder().decode(Context.toString(arg(a, 0))), StandardCharsets.UTF_8);
                } catch (IllegalArgumentException e) {
                    throw Context.reportRuntimeError("base64Decode: not valid base64");
                }
            }));
            def(sc, "__sha256", fn(a -> hex(sha256(Context.toString(arg(a, 0))))));
            def(sc, "__hmac", fn(a -> {
                try {
                    javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
                    mac.init(new javax.crypto.spec.SecretKeySpec(Context.toString(arg(a, 0)).getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
                    return hex(mac.doFinal(Context.toString(arg(a, 1)).getBytes(StandardCharsets.UTF_8)));
                } catch (java.security.GeneralSecurityException e) {
                    throw Context.reportRuntimeError("hmacSha256 failed");
                }
            }));
            cx.evaluateString(sc, PRELUDE, "prelude", 1, null);
            cx.evaluateString(sc, script, "pre-request script", 1, null);
            String out = Context.toString(cx.evaluateString(sc, "__finish()", "finish", 1, null));
            JsonNode n = json.readTree(out);
            List<Header> outHeaders = new ArrayList<>();
            Map<String, String> seen = new LinkedHashMap<>();
            JsonNode hn = n.get("headers");
            if (hn != null && hn.isObject()) {
                Iterator<Map.Entry<String, JsonNode>> it = hn.fields();
                while (it.hasNext()) {
                    Map.Entry<String, JsonNode> e = it.next();
                    if (e.getValue() != null && !e.getValue().isNull()) seen.put(e.getKey(), e.getValue().asText());
                }
            }
            seen.forEach((k, v) -> outHeaders.add(new Header(k, v)));
            String m = n.hasNonNull("method") ? n.get("method").asText() : method;
            String u = n.hasNonNull("url") ? n.get("url").asText() : url;
            String b = n.hasNonNull("body") ? n.get("body").asText() : null;
            return new Result(m, u, outHeaders, b, log);
        } catch (ScriptTimeout t) {
            throw ApiException.badRequest("Pre-request script took longer than " + MAX_MILLIS / 1000 + " seconds and was stopped");
        } catch (RhinoException e) {
            String where = e.lineNumber() > 0 && "pre-request script".equals(e.sourceName()) ? " (line " + e.lineNumber() + ")" : "";
            throw ApiException.badRequest("Pre-request script error: " + e.details() + where);
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw ApiException.badRequest("Pre-request script left the request in an unusable state: " + e.getOriginalMessage());
        } finally {
            Context.exit();
        }
    }

    private static Object arg(Object[] a, int i) {
        return a.length > i ? a[i] : Undefined.instance;
    }

    private static void def(Scriptable scope, String name, Object value) {
        ScriptableObject.putProperty(scope, name, value);
    }

    private static BaseFunction fn(Function<Object[], Object> f) {
        return new BaseFunction() {
            @Override
            public Object call(Context cx, Scriptable scope, Scriptable thisObj, Object[] args) {
                return f.apply(args);
            }
        };
    }

    private static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static String hex(byte[] b) {
        return HexFormat.of().formatHex(b);
    }

    @SuppressWarnings("unused")
    private static final Class<?> KEEP = Callable.class;
}
