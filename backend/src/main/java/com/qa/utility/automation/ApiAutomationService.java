package com.qa.utility.automation;

import com.qa.utility.automation.ApiDtos.*;
import com.qa.utility.exception.ApiException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
public class ApiAutomationService {
    private static final Set<String> METHODS = Set.of("GET", "POST", "PUT", "PATCH", "DELETE");
    private static final Set<String> SOURCES = Set.of("BODY", "BODY_REGEX", "HEADER", "STATUS");
    private final ApiAutomationRepository repo;
    private final ApiExecutor executor;
    private final com.qa.utility.folder.FolderService folders;

    public ApiAutomationService(ApiAutomationRepository repo, ApiExecutor executor, com.qa.utility.folder.FolderService folders) {
        this.repo = repo;
        this.executor = executor;
        this.folders = folders;
    }

    public void moveRequest(long id, Long folderId) {
        repo.request(id).orElseThrow(() -> ApiException.notFound("API request not found"));
        repo.moveRequest(id, folders.requireFolder("REQUEST", folderId));
    }

    public ApiDtos.PreviewResult preview(ApiRequestDef r) {
        return executor.preview(normalise(r));
    }

    public List<ApiRequestDef> requests() {
        return repo.requests();
    }

    public ApiRequestDef saveRequest(Long id, ApiRequestDef r) {
        ApiRequestDef n = normalise(r);
        try {
            if (id == null) return n.withId(repo.insert(n));
            repo.request(id).orElseThrow(() -> ApiException.notFound("API request not found"));
            repo.update(id, n);
            return n.withId(id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("An API request named '" + n.name() + "' already exists");
        }
    }

    public void deleteRequest(long id) {
        if (repo.requestInUse(id)) throw ApiException.conflict("This request is used by an API workflow or a workflow step. Remove it there first.");
        repo.deleteRequest(id);
    }

    public ApiRunResult run(ApiRequestDef r) {
        return executor.run(normalise(r));
    }

    private ApiRequestDef normalise(ApiRequestDef r) {
        String m = r.method().trim().toUpperCase(Locale.ROOT);
        if (!METHODS.contains(m)) throw ApiException.badRequest("Method must be one of " + METHODS);
        for (Extraction x : r.extractions()) {
            VariableService.validateName(x.variable().trim());
            if (!SOURCES.contains(x.source().toUpperCase(Locale.ROOT))) throw ApiException.badRequest("Extraction source must be one of " + SOURCES);
        }
        List<Extraction> ex = r.extractions().stream().map(x -> new Extraction(x.variable().trim(), x.source().toUpperCase(Locale.ROOT), x.path(), x.secret(), x.folderId() == null ? null : folders.requireFolder("VARIABLE", x.folderId()))).toList();
        return new ApiRequestDef(r.id(), r.name().trim(), r.description(), m, r.url().trim(), r.headers(), r.body(), ex, r.expectedStatus(),
                r.preScript() == null || r.preScript().isBlank() ? null : r.preScript(), folders.requireFolder("REQUEST", r.folderId()));
    }
}
