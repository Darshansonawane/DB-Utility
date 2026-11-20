package com.qa.utility.folder;

import com.qa.utility.audit.AuditService;
import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderDtos.Folder;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Folder trees shared by requests, API workflows, variables and information pages. Folders only organise things: deleting a
 * folder never deletes the items inside it, they move to "Unfiled" (folder 0).
 */
@Service
public class FolderService {
    public static final Set<String> KINDS = Set.of("REQUEST", "API_WORKFLOW", "VARIABLE", "INFO", "WORKFLOW", "QUERY");
    private static final int MAX_DEPTH = 8;
    private static final Map<String, String> ITEM_TABLE = Map.of(
            "REQUEST", "api_request", "API_WORKFLOW", "api_workflow", "VARIABLE", "api_variable", "INFO", "info_item", "WORKFLOW", "workflow", "QUERY", "saved_query");

    private final JdbcTemplate jdbc;
    private final AuditService audit;
    private final com.qa.utility.project.ProjectRepository projectRepository;

    public FolderService(JdbcTemplate jdbc, AuditService audit, com.qa.utility.project.ProjectRepository projectRepository) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.projectRepository = projectRepository;
    }

    public List<Folder> list(String kind) {
        return list(kind, null);
    }

    /** {@code projectId} (WORKFLOW folders only) limits the list to one project. */
    public List<Folder> list(String kind, Long projectId) {
        checkKind(kind);
        String sql = "SELECT id, kind, parent_id, name, project_id FROM folder WHERE kind = ?" + (projectId == null ? "" : " AND project_id = ?") + " ORDER BY LOWER(name)";
        Object[] args = projectId == null ? new Object[]{kind} : new Object[]{kind, projectId};
        return jdbc.query(sql, (rs, i) -> new Folder(rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getString(4), rs.getLong(5)), args);
    }

    public Folder get(long id) {
        return jdbc.query("SELECT id, kind, parent_id, name, project_id FROM folder WHERE id = ?",
                (rs, i) -> new Folder(rs.getLong(1), rs.getString(2), rs.getLong(3), rs.getString(4), rs.getLong(5)), id).stream().findFirst()
                .orElseThrow(() -> ApiException.notFound("Folder not found"));
    }

    public Folder create(String kind, Long parentId, String name) {
        return create(kind, parentId, name, null);
    }

    /**
     * WORKFLOW folders belong to a project: the parent folder's project, else {@code projectId}, else the default project. A sub-folder is
     * always in its parent's project. Other kinds ignore projects.
     */
    public Folder create(String kind, Long parentId, String name, Long projectId) {
        checkKind(kind);
        long parent = parentId == null ? 0 : parentId;
        String n = cleanName(name);
        long project = 0;
        if (parent != 0) {
            Folder p = get(parent);
            if (!p.kind().equals(kind)) throw ApiException.badRequest("Parent folder belongs to a different area");
            if (depth(parent) >= MAX_DEPTH) throw ApiException.badRequest("Folders can be nested at most " + MAX_DEPTH + " levels deep");
            project = p.projectId();
            if (kind.equals("WORKFLOW") && projectId != null && projectId != 0 && projectId != project) {
                throw ApiException.badRequest("The parent folder belongs to a different project");
            }
        } else if (kind.equals("WORKFLOW")) {
            project = projectId == null || projectId == 0 ? defaultProjectId() : requireProjectId(projectId);
        }
        try {
            jdbc.update("INSERT INTO folder (kind, parent_id, name, project_id) VALUES (?,?,?,?)", kind, parent, n, project);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A folder named '" + n + "' already exists here");
        }
        Long id = jdbc.queryForObject("SELECT id FROM folder WHERE kind = ? AND project_id = ? AND parent_id = ? AND name = ?", Long.class, kind, project, parent, n);
        audit.record("FOLDER_CREATED", null, null, null, null, "SUCCESS", kind + ": " + n);
        return get(id);
    }

    public Folder update(long id, String name, Long parentId) {
        Folder f = get(id);
        String n = name == null ? f.name() : cleanName(name);
        long parent = parentId == null ? f.parentId() : parentId;
        if (parent != f.parentId()) {
            if (parent == id) throw ApiException.badRequest("A folder cannot be moved into itself");
            if (parent != 0) {
                Folder p = get(parent);
                if (!p.kind().equals(f.kind())) throw ApiException.badRequest("Target folder belongs to a different area");
                if (p.projectId() != f.projectId()) throw ApiException.badRequest("A folder can only be moved within its own project");
                if (descendants(id).contains(parent)) throw ApiException.badRequest("A folder cannot be moved into one of its own subfolders");
                if (depth(parent) + 1 + subtreeHeight(id) > MAX_DEPTH) throw ApiException.badRequest("That would nest folders deeper than " + MAX_DEPTH + " levels");
            }
        }
        try {
            jdbc.update("UPDATE folder SET name = ?, parent_id = ? WHERE id = ?", n, parent, id);
        } catch (DuplicateKeyException e) {
            throw ApiException.conflict("A folder named '" + n + "' already exists there");
        }
        audit.record("FOLDER_UPDATED", null, null, null, null, "SUCCESS", f.kind() + ": " + f.name() + " -> " + n);
        return get(id);
    }

    /** Deletes the folder and its subfolders. Items inside move to Unfiled. Folder-scoped variables must be moved or deleted first. */
    public void delete(long id) {
        Folder f = get(id);
        Set<Long> ids = descendants(id);
        ids.add(id);
        String in = ids.stream().map(String::valueOf).collect(Collectors.joining(","));
        if (f.kind().equals("VARIABLE")) {
            List<String> scoped = jdbc.queryForList("SELECT name FROM api_variable WHERE scope = 'FOLDER' AND folder_id IN (" + in + ")", String.class);
            if (!scoped.isEmpty()) {
                throw ApiException.conflict("This folder contains folder-scoped variables (" + String.join(", ", scoped)
                        + "). Move them or change their scope first.");
            }
        }
        jdbc.update("UPDATE " + ITEM_TABLE.get(f.kind()) + " SET folder_id = 0 WHERE folder_id IN (" + in + ")");
        jdbc.update("DELETE FROM folder WHERE id IN (" + in + ")");
        audit.record("FOLDER_DELETED", null, null, null, null, "SUCCESS", f.kind() + ": " + f.name());
    }

    /** Validates a workflow folder (0 = directly in the project) and that it belongs to {@code projectId}. */
    public long requireWorkflowFolder(Long folderId, long projectId) {
        long id = folderId == null ? 0 : folderId;
        if (id == 0) return 0;
        Folder f = get(id);
        if (!f.kind().equals("WORKFLOW")) throw ApiException.badRequest("That folder belongs to a different area");
        if (f.projectId() != projectId) throw ApiException.badRequest("That folder belongs to a different project");
        return id;
    }

    private long defaultProjectId() {
        return projectRepository.defaultProjectId();
    }

    private long requireProjectId(long id) {
        if (!projectRepository.exists(id)) throw ApiException.badRequest("Project not found");
        return id;
    }

    /** Validates that folderId (0 = Unfiled) exists and is of the right kind. */
    public long requireFolder(String kind, Long folderId) {
        long id = folderId == null ? 0 : folderId;
        if (id == 0) return 0;
        Folder f = get(id);
        if (!f.kind().equals(kind)) throw ApiException.badRequest("That folder belongs to a different area");
        return id;
    }

    /** The folder and its ancestors, nearest first. */
    public List<Long> chain(Long folderId) {
        List<Long> out = new ArrayList<>();
        long cur = folderId == null ? 0 : folderId;
        int guard = 0;
        while (cur != 0 && guard++ < 20) {
            out.add(cur);
            List<Long> p = jdbc.queryForList("SELECT parent_id FROM folder WHERE id = ?", Long.class, cur);
            cur = p.isEmpty() ? 0 : p.get(0);
        }
        return out;
    }

    /** "Wallet / Savings" style path for display. */
    public Map<Long, String> paths(String kind) {
        List<Folder> all = list(kind);
        Map<Long, Folder> byId = new HashMap<>();
        all.forEach(f -> byId.put(f.id(), f));
        Map<Long, String> out = new HashMap<>();
        for (Folder f : all) {
            StringBuilder sb = new StringBuilder(f.name());
            long p = f.parentId();
            int guard = 0;
            while (p != 0 && byId.containsKey(p) && guard++ < 20) {
                sb.insert(0, byId.get(p).name() + " / ");
                p = byId.get(p).parentId();
            }
            out.put(f.id(), sb.toString());
        }
        return out;
    }

    private Set<Long> descendants(long id) {
        Set<Long> out = new LinkedHashSet<>();
        List<Long> frontier = List.of(id);
        int guard = 0;
        while (!frontier.isEmpty() && guard++ < 20) {
            String in = frontier.stream().map(String::valueOf).collect(Collectors.joining(","));
            List<Long> kids = jdbc.queryForList("SELECT id FROM folder WHERE parent_id IN (" + in + ")", Long.class);
            kids.removeIf(out::contains);
            out.addAll(kids);
            frontier = kids;
        }
        return out;
    }

    private int depth(long id) {
        return chain(id).size();
    }

    private int subtreeHeight(long id) {
        int h = 0;
        List<Long> frontier = List.of(id);
        while (!frontier.isEmpty() && h < 20) {
            String in = frontier.stream().map(String::valueOf).collect(Collectors.joining(","));
            frontier = jdbc.queryForList("SELECT id FROM folder WHERE parent_id IN (" + in + ")", Long.class);
            if (!frontier.isEmpty()) h++;
        }
        return h;
    }

    private static void checkKind(String kind) {
        if (kind == null || !KINDS.contains(kind)) throw ApiException.badRequest("Folder kind must be one of " + KINDS);
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.trim();
        if (n.isEmpty()) throw ApiException.badRequest("Folder name is required");
        if (n.length() > 120) throw ApiException.badRequest("Folder name is too long");
        if (n.contains("/") || n.contains("\\")) throw ApiException.badRequest("Folder names cannot contain / or \\");
        return n;
    }
}
