package com.qa.utility.automation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.qa.utility.audit.AuditService;
import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.config.AppProperties;
import com.qa.utility.folder.FolderService;
import com.qa.utility.exception.ApiException;
import org.springframework.stereotype.Service;

import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sends one API request: resolves {{variables}}, enforces the QA/Staging/Development URL policy, never follows redirects,
 * caps the response size, then extracts values from the response into variables.
 */
@Service
public class ApiExecutor {
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final Set<String> FORBIDDEN_HEADERS = Set.of("host", "content-length", "connection", "transfer-encoding", "upgrade", "expect");
    private static final Set<String> SENSITIVE_RESPONSE_HEADERS = Set.of("set-cookie", "authorization", "proxy-authenticate", "www-authenticate");
    private static final Pattern HEADER_NAME = Pattern.compile("^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$");
    private static final int MAX_BODY_BYTES = 1_000_000;

    private final VariableService variables;
    private final PreRequestScriptRunner scripts;
    private final FolderService folders;
    private final AuditService audit;
    private final AppProperties props;
    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(10)).build();

    public ApiExecutor(VariableService variables, PreRequestScriptRunner scripts, FolderService folders, AuditService audit, AppProperties props) {
        this.variables = variables;
        this.scripts = scripts;
        this.folders = folders;
        this.audit = audit;
        this.props = props;
    }

    /** Raw outcome of one HTTP call. {@code fatal} errors (policy, missing variable, bad definition) are never retried. */
    public record Exchange(Integer status, Map<String, List<String>> headers, String body, boolean truncated, String displayUrl,
                           long durationMs, String error, boolean fatal, List<String> log, SentRequest sent) {
        public boolean failed() {
            return error != null;
        }
    }

    /** Sends the request, extracts values into variables and judges success (status check + all extractions found). */
    public ApiRunResult run(ApiRequestDef def) {
        return run(def, null);
    }

    public ApiRunResult run(ApiRequestDef def, VarScope scope) {
        Exchange x = exchange(def, scope);
        if (x.failed()) return toResult(def, x, List.of(), x.error());
        List<String> problems = new ArrayList<>();
        problems.addAll(statusProblems(def, x));
        List<ExtractedValue> extracted = extract(def, x, scope, problems);
        return toResult(def, x, extracted, problems.isEmpty() ? null : String.join("; ", problems));
    }

    public ApiRunResult toResult(ApiRequestDef def, Exchange x, List<ExtractedValue> extracted, String error) {
        Map<String, List<String>> shown = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        if (x.headers() != null) {
            x.headers().forEach((k, v) -> shown.put(k, SENSITIVE_RESPONSE_HEADERS.contains(k.toLowerCase(Locale.ROOT)) ? List.of(VariableService.MASK) : v));
        }
        return new ApiRunResult(def.name(), error == null, x.status(), x.durationMs(), x.displayUrl(), shown, x.body(), x.truncated(), extracted, error, x.log() == null ? List.of() : x.log(), x.sent());
    }

    public List<String> statusProblems(ApiRequestDef def, Exchange x) {
        int status = x.status() == null ? 0 : x.status();
        boolean ok = def.expectedStatus() != null ? status == def.expectedStatus() : status >= 200 && status < 300;
        return ok ? List.of() : List.of("Unexpected status " + status + (def.expectedStatus() != null ? " (expected " + def.expectedStatus() + ")" : " (expected 2xx)"));
    }

    /** Applies the request's extractions: found values are stored as variables; missing ones are added to {@code problems}. */
    public List<ExtractedValue> extract(ApiRequestDef def, Exchange x, VarScope scope, List<String> problems) {
        List<ExtractedValue> extracted = new ArrayList<>();
        JsonNode tree = null;
        boolean parsed = false;
        for (Extraction e : def.extractions()) {
            if (!parsed && e.source().equalsIgnoreCase("BODY")) {
                tree = parseJson(x.body());
                parsed = true;
            }
            String val = extractOne(e, x, tree);
            if (val == null) {
                extracted.add(new ExtractedValue(e.variable(), null, e.secret(), false));
                problems.add("Could not extract '" + e.variable() + "' (" + e.source() + (e.path() == null || e.path().isBlank() ? "" : " " + e.path()) + ")");
            } else {
                variables.put(e.variable().trim(), val, e.secret(), "api:" + def.name(), scope, e.folderId());
                extracted.add(new ExtractedValue(e.variable(), e.secret() ? VariableService.MASK : val, e.secret(), true));
            }
        }
        return extracted;
    }

    /** What would be sent, with every {{variable}} that can be resolved filled in (secrets masked). Nothing is sent and no script runs. */
    public ApiDtos.PreviewResult preview(ApiRequestDef def) {
        VarScope local = new VarScope(false);
        local.setEnvironment(variables.effectiveEnvironment());
        local.setStepFolders(folders.chain(def.folderId()));
        List<ApiDtos.TokenInfo> tokens = new ArrayList<>();
        tokens.addAll(variables.analyze(def.url(), local));
        Map<String, String> headers = new LinkedHashMap<>();
        for (Header h : def.headers()) {
            if (h.name() == null || h.name().isBlank()) continue;
            tokens.addAll(variables.analyze(h.value(), local));
            headers.put(h.name().trim(), SENSITIVE_HEADER.matcher(h.name()).matches() ? VariableService.MASK : variables.previewText(h.value(), local));
        }
        tokens.addAll(variables.analyze(def.body(), local));
        boolean ready = tokens.stream().allMatch(ApiDtos.TokenInfo::found);
        return new ApiDtos.PreviewResult(def.method().toUpperCase(Locale.ROOT), variables.previewText(def.url(), local), headers,
                def.body() == null ? null : variables.previewText(def.body(), local), tokens, ready);
    }

    private static final Pattern SENSITIVE_HEADER = Pattern.compile("(?i).*(authorization|cookie|token|secret|password|api-?key|jwt|assertion|signature).*");

    /** Performs the HTTP call only: runs the pre-request script, resolves variables, enforces the URL policy, never follows redirects. */
    public Exchange exchange(ApiRequestDef def, VarScope scope) {
        String method = def.method().trim().toUpperCase(Locale.ROOT);
        List<String> log = new ArrayList<>();
        if (!METHODS.contains(method)) return new Exchange(null, Map.of(), null, false, def.url(), 0, "Method must be one of " + METHODS, true, log, null);
        String displayUrl = def.url();
        long start = System.nanoTime();
        SentRequest sent = null;
        try {
            // a run scope, or a private one so values set by the script resolve in this call (and are shared per the scope's rules)
            VarScope local = scope != null ? scope : new VarScope(true);
            if (local.environment() == null) local.setEnvironment(variables.effectiveEnvironment());
            local.setStepFolders(folders.chain(def.folderId())); // FOLDER-scoped variables of this request's folder apply
            String urlT = def.url().trim();
            List<Header> headersT = def.headers();
            String bodyT = def.body();
            if (def.preScript() != null && !def.preScript().isBlank()) {
                PreRequestScriptRunner.Result r = scripts.run(def.preScript(), method, urlT, headersT, bodyT, local);
                log.addAll(r.log());
                method = r.method().trim().toUpperCase(Locale.ROOT);
                urlT = r.url().trim();
                headersT = r.headers();
                bodyT = r.body();
                if (!METHODS.contains(method)) throw ApiException.badRequest("The script set an unsupported method '" + method + "'");
            }
            VariableService.Resolved ru = variables.resolveBoth(urlT, local);
            String url = ru.real();
            displayUrl = ru.display();
            checkUrl(url);
            HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30));
            boolean hasContentType = false;
            Map<String, String> shownHeaders = new LinkedHashMap<>();
            for (Header h : headersT) {
                if (h.name() == null || h.name().isBlank()) continue;
                String n = h.name().trim();
                if (!HEADER_NAME.matcher(n).matches()) throw ApiException.badRequest("Invalid header name '" + n + "'");
                if (FORBIDDEN_HEADERS.contains(n.toLowerCase(Locale.ROOT))) continue;
                if (n.equalsIgnoreCase("content-type")) hasContentType = true;
                VariableService.Resolved rv = variables.resolveBoth(h.value() == null ? "" : h.value(), local);
                String v = rv.real();
                if (v.indexOf('\r') >= 0 || v.indexOf('\n') >= 0) throw ApiException.badRequest("Header '" + n + "' contains a line break");
                rb.header(n, v);
                shownHeaders.put(n, SENSITIVE_HEADER.matcher(n).matches() && !v.isEmpty() ? VariableService.MASK : rv.display());
            }
            VariableService.Resolved rbody = bodyT == null || bodyT.isBlank() ? null : variables.resolveBoth(bodyT, local);
            String body = rbody == null ? null : rbody.real();
            boolean allowsBody = !method.equals("GET");
            if (body != null && allowsBody && !hasContentType) {
                String t = body.trim();
                String ct = t.startsWith("{") || t.startsWith("[") ? "application/json" : "text/plain";
                rb.header("Content-Type", ct);
                shownHeaders.put("Content-Type", ct);
            }
            sent = new SentRequest(method, displayUrl, shownHeaders, rbody == null || !allowsBody ? null : rbody.display());
            rb.method(method, body != null && allowsBody ? HttpRequest.BodyPublishers.ofString(body) : HttpRequest.BodyPublishers.noBody());
            HttpResponse<byte[]> res = client.send(rb.build(), HttpResponse.BodyHandlers.ofByteArray());
            long ms = (System.nanoTime() - start) / 1_000_000;
            boolean truncated = res.body().length > MAX_BODY_BYTES;
            String text = new String(res.body(), 0, Math.min(res.body().length, MAX_BODY_BYTES), StandardCharsets.UTF_8);
            Map<String, List<String>> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
            res.headers().map().forEach(headers::put);
            audit(method, displayUrl, true, res.statusCode(), null);
            return new Exchange(res.statusCode(), headers, text, truncated, displayUrl, ms, null, false, log, sent);
        } catch (ApiException e) {
            audit(method, displayUrl, false, null, e.getMessage());
            return new Exchange(null, Map.of(), null, false, displayUrl, (System.nanoTime() - start) / 1_000_000, e.getMessage(), true, log, sent);
        } catch (java.net.http.HttpTimeoutException e) {
            audit(method, displayUrl, false, null, "Request timed out");
            return new Exchange(null, Map.of(), null, false, displayUrl, (System.nanoTime() - start) / 1_000_000, "Request timed out", false, log, sent);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Exchange(null, Map.of(), null, false, displayUrl, 0, "Interrupted", true, log, sent);
        } catch (Exception e) {
            Throwable t = e;
            while (t.getCause() != null && t.getCause() != t) t = t.getCause();
            String msg = "Request failed: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
            audit(method, displayUrl, false, null, msg);
            return new Exchange(null, Map.of(), null, false, displayUrl, (System.nanoTime() - start) / 1_000_000, msg, false, log, sent);
        }
    }

    private void audit(String method, String displayUrl, boolean ok, Integer status, String detail) {
        String u = displayUrl == null ? "" : displayUrl;
        int q = u.indexOf('?');
        if (q >= 0) u = u.substring(0, q) + "?…"; // query strings may carry secrets
        audit.record("API_CALL", null, method + " " + u, null, status, ok ? "SUCCESS" : "FAILED", detail);
    }

    /** Environment policy: http(s) only, no production-looking hosts, no link-local / metadata addresses. */
    void checkUrl(String url) {
        URI u;
        try {
            u = URI.create(url);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Invalid URL: " + e.getMessage());
        }
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) throw ApiException.badRequest("URL must start with http:// or https://");
        String host = u.getHost();
        if (host == null || host.isBlank()) throw ApiException.badRequest("URL has no host");
        String lower = host.toLowerCase(Locale.ROOT);
        for (String p : props.blockedHostPatterns()) {
            if (lower.contains(p.toLowerCase(Locale.ROOT))) {
                throw ApiException.badRequest("Host matches blocked pattern '" + p + "'. API automation is restricted to QA, Staging and Development environments.");
            }
        }
        try {
            for (InetAddress a : InetAddress.getAllByName(host)) {
                if (a.isLinkLocalAddress() || a.isAnyLocalAddress() || a.isMulticastAddress()) {
                    throw ApiException.badRequest("Host resolves to a link-local/unspecified address, which is blocked");
                }
            }
        } catch (java.net.UnknownHostException e) {
            throw ApiException.badRequest("Cannot resolve host '" + host + "'. Is the VPN connected?");
        }
    }

    private String extractOne(Extraction x, Exchange res, JsonNode tree) {
        String path = x.path() == null ? "" : x.path().trim();
        String body = res.body() == null ? "" : res.body();
        switch (x.source().toUpperCase(Locale.ROOT)) {
            case "STATUS":
                return res.status() == null ? null : String.valueOf(res.status());
            case "HEADER":
                return headerValue(res.headers(), path);
            case "BODY_REGEX": {
                if (path.isEmpty()) return null;
                try {
                    Matcher m = Pattern.compile(path).matcher(body);
                    if (!m.find()) return null;
                    return m.groupCount() >= 1 ? m.group(1) : m.group();
                } catch (RuntimeException e) {
                    throw ApiException.badRequest("Invalid regular expression for '" + x.variable() + "': " + e.getMessage());
                }
            }
            case "BODY": {
                if (tree == null) return null;
                JsonNode n = jsonPath(tree, path);
                if (n == null || n.isMissingNode() || n.isNull()) return null;
                return n.isValueNode() ? n.asText() : n.toString();
            }
            default:
                throw ApiException.badRequest("Unknown extraction source '" + x.source() + "'. Use BODY, BODY_REGEX, HEADER or STATUS.");
        }
    }

    static String headerValue(Map<String, List<String>> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, List<String>> e : headers.entrySet()) {
            if (e.getKey().equalsIgnoreCase(name) && !e.getValue().isEmpty()) return e.getValue().get(0);
        }
        return null;
    }

    JsonNode parseJson(String text) {
        try {
            return text == null ? null : json.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    /** Minimal JSON path: data.wallet.id, items[0].id, $.a.b, ["odd key"] is not supported. */
    static JsonNode jsonPath(JsonNode root, String path) {
        String p = path.startsWith("$.") ? path.substring(2) : path.equals("$") ? "" : path;
        JsonNode cur = root;
        if (p.isEmpty()) return cur;
        for (String part : p.split("\\.")) {
            Matcher m = Pattern.compile("^([^\\[\\]]*)((?:\\[\\d+])*)$").matcher(part);
            if (!m.matches()) return null;
            if (!m.group(1).isEmpty()) cur = cur.get(m.group(1));
            if (cur == null) return null;
            Matcher idx = Pattern.compile("\\[(\\d+)]").matcher(m.group(2));
            while (idx.find()) {
                cur = cur.get(Integer.parseInt(idx.group(1)));
                if (cur == null) return null;
            }
        }
        return cur;
    }
}
