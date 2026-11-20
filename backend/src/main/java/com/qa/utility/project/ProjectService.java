package com.qa.utility.project;

import com.qa.utility.audit.AuditService;
import com.qa.utility.exception.ApiException;
import com.qa.utility.project.ProjectDtos.ProjectRequest;
import com.qa.utility.project.ProjectDtos.ProjectView;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Projects are the top level of the Workflow Manager: Project -> Folders -> Workflows. A project is never deleted together with its
 * contents by accident: deleting a non-empty project requires choosing the project that receives its folders and workflows.
 */
@Service
public class ProjectService {
    private final ProjectRepository repo;
    private final JdbcTemplate jdbc;
    private final AuditService audit;

    public ProjectService(ProjectRepository repo, JdbcTemplate jdbc, AuditService audit) {
        this.repo = repo;
        this.jdbc = jdbc;
        this.audit = audit;
    }

    public List<ProjectView> list() {
        return repo.findAll();
    }

    public ProjectView get(long id) {
        return repo.findById(id).orElseThrow(() -> ApiException.notFound("Project not found"));
    }

    public ProjectView create(ProjectRequest r) {
        String name = cleanName(r.name());
        try {
            long id = repo.insert(name, clean(r.description()));
            audit.record("PROJECT_CREATED", null, null, null, null, "SUCCESS", name);
            return get(id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A project named '" + name + "' already exists");
        }
    }

    public ProjectView update(long id, ProjectRequest r) {
        ProjectView old = get(id);
        String name = cleanName(r.name());
        try {
            repo.update(id, name, clean(r.description()));
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A project named '" + name + "' already exists");
        }
        audit.record("PROJECT_UPDATED", null, null, null, null, "SUCCESS", old.name() + " -> " + name);
        return get(id);
    }

    /**
     * Empty projects are simply deleted. A project that still holds folders or workflows is deleted only when {@code moveTo} names another
     * project: its folders (with their sub-folders) and workflows move there, keeping their ids, configuration and run history.
     */
    @Transactional
    public void delete(long id, Long moveTo) {
        ProjectView p = get(id);
        if (p.folderCount() > 0 || p.workflowCount() > 0) {
            if (moveTo == null) {
                throw ApiException.conflict("'" + p.name() + "' still contains " + p.workflowCount() + " workflow(s) and " + p.folderCount()
                        + " folder(s). Choose a project to move them to, or move or delete them first.");
            }
            if (moveTo == id) throw ApiException.badRequest("Choose a different project to move the contents to");
            ProjectView target = get(moveTo);
            moveContents(p, target);
        }
        repo.delete(id);
        audit.record("PROJECT_DELETED", null, null, null, null, "SUCCESS", p.name() + (moveTo == null ? "" : " (contents moved to project " + moveTo + ")"));
    }

    private void moveContents(ProjectView from, ProjectView to) {
        // top-level folders and workflows of the target must keep unique names: rename an arriving duplicate rather than refuse or overwrite
        for (Long fid : jdbc.queryForList("SELECT id FROM folder WHERE kind = 'WORKFLOW' AND project_id = ? AND parent_id = 0", Long.class, from.id())) {
            String name = jdbc.queryForObject("SELECT name FROM folder WHERE id = ?", String.class, fid);
            String free = freeName("folder", "name", name, from.name(), "kind = 'WORKFLOW' AND project_id = " + to.id() + " AND parent_id = 0");
            jdbc.update("UPDATE folder SET name = ? WHERE id = ?", free, fid);
        }
        for (Long wid : jdbc.queryForList("SELECT id FROM workflow WHERE project_id = ?", Long.class, from.id())) {
            String name = jdbc.queryForObject("SELECT name FROM workflow WHERE id = ?", String.class, wid);
            String free = freeName("workflow", "name", name, from.name(), "project_id = " + to.id());
            if (!free.equals(name)) jdbc.update("UPDATE workflow SET name = ? WHERE id = ?", free, wid);
        }
        jdbc.update("UPDATE folder SET project_id = ? WHERE kind = 'WORKFLOW' AND project_id = ?", to.id(), from.id());
        jdbc.update("UPDATE workflow SET project_id = ? WHERE project_id = ?", to.id(), from.id());
        repo.touch(to.id());
    }

    private String freeName(String table, String column, String name, String fromProject, String where) {
        String candidate = name;
        int n = 1;
        while (jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + where + " AND " + column + " = ?", Integer.class, candidate) > 0) {
            candidate = name + " (from " + fromProject + (n > 1 ? " " + n : "") + ")";
            n++;
        }
        return candidate;
    }

    /** Validates a project id; null means "the default project". */
    public long requireProject(Long projectId) {
        if (projectId == null || projectId == 0) return repo.defaultProjectId();
        if (!repo.exists(projectId)) throw ApiException.badRequest("Project not found");
        return projectId;
    }

    public void touch(long projectId) {
        repo.touch(projectId);
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw ApiException.badRequest("Project name is required");
        if (n.length() > 120) throw ApiException.badRequest("Project name is too long");
        return n;
    }

    private static String clean(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
