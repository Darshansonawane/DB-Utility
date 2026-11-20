package com.qa.utility.automation;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Variables private to one workflow run, plus the folders the run executes in. Lookup precedence for {{name}}:
 * run scope, then FOLDER variables (nearest folder first), then ENVIRONMENT variables of the active environment, then GLOBAL.
 * When {@code publishGlobal} is true values are also copied to the shared store (so they appear under Variables and can be used
 * by manual query runs).
 */
public final class VarScope {
    public record Entry(String value, boolean secret) {
    }

    final Map<String, Entry> local = new ConcurrentHashMap<>();
    final boolean publishGlobal;
    private volatile List<Long> baseFolders = List.of();
    private volatile List<Long> stepFolders = List.of();

    public VarScope(boolean publishGlobal) {
        this.publishGlobal = publishGlobal;
    }

    public void set(String name, String value, boolean secret) {
        local.put(name, new Entry(value, secret));
    }

    public Entry get(String name) {
        Entry e = local.get(name);
        if (e != null) return e;
        java.util.function.Function<String, String> r = stepResolver;
        String v = r == null ? null : r.apply(name);
        return v == null ? null : new Entry(v, false);
    }

    private volatile java.util.function.Function<String, String> stepResolver;

    /** Lets {{step2.data.id}} read the retained response of an earlier step of the workflow that owns this scope. */
    public void setStepResolver(java.util.function.Function<String, String> resolver) {
        this.stepResolver = resolver;
    }

    public java.util.function.Function<String, String> stepResolver() {
        return stepResolver;
    }

    /** Folders of the workflow this scope belongs to (nearest first). */
    public void setBaseFolders(List<Long> folders) {
        this.baseFolders = List.copyOf(folders);
    }

    /** Folders of the request/query currently executing (nearest first); replaced for every step. */
    public void setStepFolders(List<Long> folders) {
        this.stepFolders = List.copyOf(folders);
    }

    public List<Long> folderChain() {
        List<Long> out = new ArrayList<>(stepFolders);
        for (Long f : baseFolders) if (!out.contains(f)) out.add(f);
        return out;
    }
}
