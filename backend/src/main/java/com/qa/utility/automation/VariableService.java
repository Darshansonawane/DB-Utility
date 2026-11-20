package com.qa.utility.automation;

import com.qa.utility.automation.ApiAutomationRepository.VarRow;
import com.qa.utility.automation.ApiDtos.TokenInfo;
import com.qa.utility.automation.ApiDtos.VariableBody;
import com.qa.utility.automation.ApiDtos.VariableView;
import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderService;
import com.qa.utility.security.CryptoService;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Variable store shared by API automation, saved queries and workflows. Reference a variable as {{name}}.
 * Precedence (most specific wins): run scope, FOLDER, ENVIRONMENT (active environment), GLOBAL.
 */
@Service
public class VariableService {
    private static final Pattern TOKEN = Pattern.compile("\\{\\{\\s*([A-Za-z_$][A-Za-z0-9_.$-]{0,99})(?:\\(([^)]*)\\))?\\s*}}");
    private static final Pattern NAME = Pattern.compile("^[A-Za-z_][A-Za-z0-9_.-]{0,99}$");
    private static final Set<String> SCOPES = Set.of("GLOBAL", "FOLDER", "ENVIRONMENT");
    private static final Set<String> ENVIRONMENTS = Set.of("QA", "UAT");
    private static final SecureRandom RND = new SecureRandom();
    public static final String MASK = "••••••••";
    static final String ENV_SETTING = "automation.activeEnvironment";

    private final ApiAutomationRepository repo;
    private final CryptoService crypto;
    private final FolderService folders;

    public VariableService(ApiAutomationRepository repo, CryptoService crypto, FolderService folders) {
        this.repo = repo;
        this.crypto = crypto;
        this.folders = folders;
    }

    public static void validateName(String name) {
        if (name == null || !NAME.matcher(name).matches()) {
            throw ApiException.badRequest("Invalid variable name '" + name + "'. Use letters, digits, _ . - (must start with a letter or _).");
        }
    }

    // ------------------------------------------------------------------ management

    public List<VariableView> list() {
        Map<Long, String> paths = folders.paths("VARIABLE");
        return repo.variables().stream().map(v -> view(v, paths)).toList();
    }

    private VariableView view(VarRow v, Map<Long, String> paths) {
        String src = v.source() == null ? "manual" : v.source();
        String type = src.startsWith("api:") ? "API" : src.startsWith("sql:") ? "SQL" : src.equals("script") ? "SCRIPT" : "MANUAL";
        String name = src.contains(":") ? src.substring(src.indexOf(':') + 1) : "";
        return new VariableView(v.id(), v.name(), v.secret() ? MASK : v.value(), v.secret(), src, type, name, v.scope(), v.folderId(),
                v.folderId() == 0 ? "" : paths.getOrDefault(v.folderId(), ""), v.environment(), v.updatedAt());
    }

    /** Creates a variable, or updates the one with the same name and scope. A null value keeps the current value (secrets are never echoed). */
    public VariableView save(Long id, VariableBody b) {
        String scope = b.scope() == null || b.scope().isBlank() ? "GLOBAL" : b.scope().toUpperCase();
        if (!SCOPES.contains(scope)) throw ApiException.badRequest("Scope must be one of " + SCOPES);
        long folder = folders.requireFolder("VARIABLE", b.folderId());
        String env = b.environment() == null ? "" : b.environment().toUpperCase();
        if (scope.equals("FOLDER") && folder == 0) throw ApiException.badRequest("A folder-scoped variable must be saved inside a folder");
        if (scope.equals("ENVIRONMENT") && !ENVIRONMENTS.contains(env)) throw ApiException.badRequest("Choose the environment (QA or UAT) for an environment variable");
        if (!scope.equals("ENVIRONMENT")) env = "";
        VarRow existing = id == null ? null : repo.variableById(id).orElseThrow(() -> ApiException.notFound("Variable not found"));
        String name = b.name() == null || b.name().isBlank() ? (existing == null ? null : existing.name()) : b.name().trim();
        validateName(name);
        String key = scopeKey(scope, folder, env);
        Optional<VarRow> clash = repo.variableByKey(name, scope, key).filter(r -> existing == null || !r.id().equals(existing.id()));
        if (clash.isPresent()) throw ApiException.conflict("A " + scope.toLowerCase() + " variable named '" + name + "' already exists" + (scope.equals("GLOBAL") ? ". Global names are unique; use a folder or environment scope for another value." : "."));
        boolean secret = b.secret();
        String stored;
        if (b.value() == null && existing != null) {
            stored = existing.value();
            if (secret != existing.secret()) {
                String plain = existing.secret() ? crypto.decrypt(existing.value()) : existing.value();
                stored = secret && plain != null ? crypto.encrypt(plain) : plain;
            }
        } else {
            String v = b.value() == null ? "" : b.value();
            stored = secret ? crypto.encrypt(v) : v;
        }
        String source = existing == null ? "manual" : existing.source();
        if (existing == null) repo.insertVariable(name, stored, secret, source, scope, key, folder, env);
        else repo.updateVariable(existing.id(), name, stored, secret, source, scope, key, folder, env);
        VarRow saved = repo.variableByKey(name, scope, key).orElseThrow();
        return view(saved, folders.paths("VARIABLE"));
    }

    public void move(long id, Long folderId) {
        VarRow v = repo.variableById(id).orElseThrow(() -> ApiException.notFound("Variable not found"));
        long folder = folders.requireFolder("VARIABLE", folderId);
        if (v.scope().equals("FOLDER") && folder == 0) throw ApiException.badRequest("A folder-scoped variable must stay inside a folder");
        String key = scopeKey(v.scope(), folder, v.environment());
        if (repo.variableByKey(v.name(), v.scope(), key).filter(r -> !r.id().equals(id)).isPresent()) {
            throw ApiException.conflict("A variable named '" + v.name() + "' already exists in the target folder scope");
        }
        repo.updateVariable(id, v.name(), v.value(), v.secret(), v.source(), v.scope(), key, folder, v.environment());
    }

    public void delete(long id) {
        repo.deleteVariableById(id);
    }

    public void clear() {
        repo.clearVariables();
    }

    public String activeEnvironment() {
        String e = repo.setting(ENV_SETTING);
        return e == null ? "" : e;
    }

    public void setActiveEnvironment(String env) {
        String e = env == null ? "" : env.trim().toUpperCase();
        if (!e.isEmpty() && !ENVIRONMENTS.contains(e)) throw ApiException.badRequest("Environment must be QA, UAT or empty");
        repo.putSetting(ENV_SETTING, e);
    }

    private static String scopeKey(String scope, long folder, String env) {
        return scope.equals("FOLDER") ? "F" + folder : scope.equals("ENVIRONMENT") ? "E" + env : "";
    }

    // ------------------------------------------------------------------ writing from extractions / scripts

    public void put(String name, String value, boolean secret, String source) {
        put(name, value, secret, source, null, null);
    }

    public void put(String name, String value, boolean secret, String source, VarScope scope) {
        put(name, value, secret, source, scope, null);
    }

    /**
     * Stores an extracted/scripted value. With a run scope the value is kept private to that run, and copied to the shared GLOBAL
     * variable only when the scope publishes. An existing global variable keeps its folder unless {@code folderId} is given.
     */
    public void put(String name, String value, boolean secret, String source, VarScope scope, Long folderId) {
        validateName(name);
        if (scope != null) {
            scope.set(name, value, secret);
            if (!scope.publishGlobal) return;
        }
        String stored = secret && value != null ? crypto.encrypt(value) : value;
        Optional<VarRow> cur = repo.variableByKey(name, "GLOBAL", "");
        long folder = folderId == null ? cur.map(VarRow::folderId).orElse(0L) : folders.requireFolder("VARIABLE", folderId);
        if (cur.isPresent()) repo.updateVariable(cur.get().id(), name, stored, secret, source, "GLOBAL", "", folder, "");
        else repo.insertVariable(name, stored, secret, source, "GLOBAL", "", folder, "");
    }

    // ------------------------------------------------------------------ resolution

    public boolean hasTokens(String text) {
        return text != null && text.contains("{{");
    }

    public String resolve(String text) {
        return resolve(text, false, null);
    }

    public String resolve(String text, boolean display) {
        return resolve(text, display, null);
    }

    /** Replaces {{name}} with the value (or a built-in such as {{$uuid}}); display=true masks secrets. */
    public String resolve(String text, boolean display, VarScope scope) {
        if (!hasTokens(text)) return text;
        Matcher m = TOKEN.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            m.appendReplacement(sb, Matcher.quoteReplacement(valueOf(m.group(1), m.group(2), display, scope)));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    /** Both forms of a substituted text, from a single pass so random built-ins match: real is sent, display is masked for secrets. */
    public record Resolved(String real, String display) {
    }

    public Resolved resolveBoth(String text, VarScope scope) {
        if (!hasTokens(text)) return new Resolved(text, text);
        Matcher m = TOKEN.matcher(text);
        StringBuilder real = new StringBuilder();
        StringBuilder shown = new StringBuilder();
        int last = 0;
        while (m.find()) {
            String plain = text.substring(last, m.start());
            real.append(plain);
            shown.append(plain);
            String r = valueOf(m.group(1), m.group(2), false, scope);
            real.append(r);
            shown.append(isSecret(m.group(1), scope) ? MASK : r);
            last = m.end();
        }
        String tail = text.substring(last);
        real.append(tail);
        shown.append(tail);
        return new Resolved(real.toString(), shown.toString());
    }

    /** Inspects every {{token}} without failing: what each resolves to (masked when secret) and where it comes from. */
    public List<TokenInfo> analyze(String text, VarScope scope) {
        List<TokenInfo> out = new ArrayList<>();
        if (!hasTokens(text)) return out;
        Matcher m = TOKEN.matcher(text);
        while (m.find()) {
            String name = m.group(1);
            String full = m.group(0);
            if (name.startsWith("$")) {
                out.add(new TokenInfo(full, name, true, "(generated when sent)", "built-in", false));
                continue;
            }
            Optional<Found> f = find(name, scope);
            out.add(f.map(x -> new TokenInfo(full, name, true, x.secret() ? MASK : x.value(), x.origin(), x.secret()))
                    .orElse(new TokenInfo(full, name, false, null, "not set", false)));
        }
        return out;
    }

    /** Substitutes what can be resolved (secrets masked) and leaves unknown {{tokens}} and generated $built-ins untouched. Never throws. */
    public String previewText(String text, VarScope scope) {
        if (!hasTokens(text)) return text;
        Matcher m = TOKEN.matcher(text);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(text, last, m.start());
            String name = m.group(1);
            if (name.startsWith("$")) {
                sb.append(m.group(0));
            } else {
                Optional<Found> f = find(name, scope);
                sb.append(f.map(x -> x.secret() ? MASK : x.value()).orElse(m.group(0)));
            }
            last = m.end();
        }
        sb.append(text.substring(last));
        return sb.toString();
    }

    private boolean isSecret(String name, VarScope scope) {
        if (name.startsWith("$")) return false;
        return find(name, scope).map(Found::secret).orElse(false);
    }

    /** Current value of a variable following the scope precedence, or empty when it is not set. */
    public Optional<String> lookup(String name, VarScope scope) {
        return find(name, scope).map(Found::value);
    }

    private record Found(String value, boolean secret, String origin) {
    }

    private Optional<Found> find(String name, VarScope scope) {
        if (scope != null && scope.get(name) != null) {
            VarScope.Entry e = scope.get(name);
            return Optional.of(new Found(e.value() == null ? "" : e.value(), e.secret(), "this run"));
        }
        List<VarRow> rows = repo.variablesNamed(name);
        if (rows.isEmpty()) return Optional.empty();
        if (scope != null) {
            for (Long fid : scope.folderChain()) {
                for (VarRow r : rows) if (r.scope().equals("FOLDER") && r.folderId() == fid) return Optional.of(found(r, "folder"));
            }
        }
        String env = activeEnvironment();
        if (!env.isEmpty()) {
            for (VarRow r : rows) if (r.scope().equals("ENVIRONMENT") && r.environment().equals(env)) return Optional.of(found(r, env + " environment"));
        }
        for (VarRow r : rows) if (r.scope().equals("GLOBAL")) return Optional.of(found(r, "global"));
        return Optional.empty();
    }

    private Found found(VarRow r, String origin) {
        String v = r.value() == null ? "" : r.secret() ? crypto.decrypt(r.value()) : r.value();
        return new Found(v, r.secret(), origin);
    }

    private static int[] ints(String args, int count) {
        int[] out = new int[count];
        java.util.Arrays.fill(out, Integer.MIN_VALUE);
        if (args == null || args.isBlank()) return out;
        String[] p = args.split(",");
        for (int i = 0; i < Math.min(p.length, count); i++) {
            try {
                out[i] = Integer.parseInt(p[i].trim().replace("+", ""));
            } catch (NumberFormatException e) {
                throw ApiException.badRequest("Invalid argument '" + p[i].trim() + "': expected a whole number");
            }
        }
        return out;
    }

    private static String random(String alphabet, int len) {
        if (len < 1 || len > 256) throw ApiException.badRequest("Length must be between 1 and 256");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < len; i++) sb.append(alphabet.charAt(RND.nextInt(alphabet.length())));
        return sb.toString();
    }

    private String valueOf(String name, String args, boolean display, VarScope scope) {
        if (args != null && !name.startsWith("$")) throw ApiException.badRequest("{{" + name + "(…)}}: only built-ins starting with $ take arguments");
        switch (name) {
            case "$uuid": return UUID.randomUUID().toString();
            case "$timestamp": return String.valueOf(System.currentTimeMillis());
            case "$isoDate": {
                int d = ints(args, 1)[0];
                return LocalDate.now().plusDays(d == Integer.MIN_VALUE ? 0 : d).toString();
            }
            case "$isoDateTime": {
                int d = ints(args, 1)[0];
                return LocalDateTime.now().plusDays(d == Integer.MIN_VALUE ? 0 : d).format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
            }
            case "$randomInt": {
                int[] a = ints(args, 2);
                int lo = a[0] == Integer.MIN_VALUE ? 100000 : a[0];
                int hi = a[1] == Integer.MIN_VALUE ? (a[0] == Integer.MIN_VALUE ? 999999 : lo + 899999) : a[1];
                if (hi < lo) throw ApiException.badRequest("$randomInt(min,max): max must not be below min");
                return String.valueOf(lo + (long) (RND.nextDouble() * ((long) hi - lo + 1)));
            }
            case "$randomString": return random("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", ints(args, 1)[0] == Integer.MIN_VALUE ? 8 : ints(args, 1)[0]);
            case "$randomNumeric": return random("0123456789", ints(args, 1)[0] == Integer.MIN_VALUE ? 8 : ints(args, 1)[0]);
            default:
                if (name.startsWith("$")) throw ApiException.badRequest("Unknown built-in {{" + name + "}}. Available: $uuid, $timestamp, $isoDate(days), $isoDateTime(days), $randomInt(min,max), $randomString(n), $randomNumeric(n)");
        }
        Found f = find(name, scope).orElseThrow(() ->
                ApiException.badRequest("Variable '" + name + "' is not set. Run the API step or query that produces it, or add it under Variables."));
        return display && f.secret() ? MASK : f.value();
    }
}
