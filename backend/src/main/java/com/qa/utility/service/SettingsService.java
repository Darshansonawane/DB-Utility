package com.qa.utility.service;

import com.qa.utility.audit.AuditService;
import com.qa.utility.config.AppProperties;
import com.qa.utility.exception.ApiException;
import com.qa.utility.model.AppSettings;
import com.qa.utility.repository.SettingsRepository;
import org.springframework.stereotype.Service;

@Service
public class SettingsService {
    private final SettingsRepository repo;
    private final AppProperties props;
    private final AuditService audit;

    public SettingsService(SettingsRepository repo, AppProperties props, AuditService audit) {
        this.repo = repo;
        this.props = props;
        this.audit = audit;
    }

    public AppSettings get() {
        return repo.load();
    }

    public AppSettings update(AppSettings s) {
        if (s.maxResultRows() < 1 || s.maxResultRows() > props.maxResultRowsCeiling())
            throw ApiException.badRequest("maxResultRows must be 1.." + props.maxResultRowsCeiling());
        if (s.maxAffectedRows() < 1 || s.maxAffectedRows() > props.maxAffectedRowsCeiling())
            throw ApiException.badRequest("maxAffectedRows must be 1.." + props.maxAffectedRowsCeiling());
        if (s.queryTimeoutSeconds() < 1 || s.queryTimeoutSeconds() > props.queryTimeoutCeilingSeconds())
            throw ApiException.badRequest("queryTimeoutSeconds must be 1.." + props.queryTimeoutCeilingSeconds());
        AppSettings before = repo.load();
        repo.save(s);
        audit.record("SETTINGS_CHANGED", null, null, null, null, "SUCCESS", before + " -> " + s);
        return s;
    }
}
