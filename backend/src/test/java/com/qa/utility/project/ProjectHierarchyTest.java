package com.qa.utility.project;

import com.qa.utility.exception.ApiException;
import com.qa.utility.folder.FolderDtos.Folder;
import com.qa.utility.folder.FolderService;
import com.qa.utility.model.*;
import com.qa.utility.model.Workflow.*;
import com.qa.utility.project.ProjectDtos.ProjectRequest;
import com.qa.utility.project.ProjectDtos.ProjectView;
import com.qa.utility.repository.WorkflowRepository;
import com.qa.utility.service.QueryLibraryService;
import com.qa.utility.support.AbstractDbTest;
import com.qa.utility.workflow.WorkflowExecutor;
import com.qa.utility.workflow.WorkflowService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class ProjectHierarchyTest extends AbstractDbTest {
    @Autowired ProjectService projects;
    @Autowired ProjectMigration migration;
    @Autowired ProjectRepository projectRepo;
    @Autowired FolderService folders;
    @Autowired WorkflowService workflowService;
    @Autowired WorkflowRepository workflowRepo;
    @Autowired WorkflowExecutor executor;
    @Autowired QueryLibraryService library;
    @Autowired JdbcTemplate meta;

    final String u = UUID.randomUUID().toString().substring(0, 8);

    ProjectView project(String name) {
        return projects.create(new ProjectRequest(name + u, "desc of " + name));
    }

    Workflow wf(String name, Long projectId, Long folderId) {
        return workflowService.create(new Workflow(null, name, "about " + name, List.of(), List.of(), folderId, projectId));
    }

    ProjectView fresh(ProjectView p) {
        return projects.get(p.id());
    }

    @Test
    void projectsContainFoldersContainWorkflowsAndTheCountsAddUp() {
        ProjectView sw = project("Savings Wallet"), hb = project("HelloBank");
        Folder e2e = folders.create("WORKFLOW", 0L, "E2E Automation", sw.id());
        Folder nested = folders.create("WORKFLOW", e2e.id(), "Regression", null);
        assertEquals(sw.id(), e2e.projectId());
        assertEquals(sw.id(), nested.projectId(), "a sub-folder always belongs to its parent's project");
        wf("Create wallet", sw.id(), e2e.id());
        wf("Goal reached", sw.id(), nested.id());
        wf("Top level flow", sw.id(), null);
        wf("Login", hb.id(), null);

        ProjectView swNow = fresh(sw), hbNow = fresh(hb);
        assertEquals(2, swNow.folderCount());
        assertEquals(3, swNow.workflowCount());
        assertEquals(0, hbNow.folderCount());
        assertEquals(1, hbNow.workflowCount());
        assertNotNull(swNow.updatedAt());
        assertEquals(sw.id(), workflowService.get(workflowRepo.findByName("Goal reached").orElseThrow().id()).projectId());
        assertEquals(List.of("E2E Automation", "Regression"), folders.list("WORKFLOW", sw.id()).stream().map(Folder::name).sorted().toList());
        assertTrue(folders.list("WORKFLOW", hb.id()).isEmpty());
    }

    @Test
    void everyWorkflowBelongsToAProjectEvenWhenCreatedWithoutOne() {
        Workflow w = workflowService.create(new Workflow(null, "legacy-style " + u, "", List.of(), List.of()));
        assertNotNull(w.projectId());
        assertTrue(projectRepo.exists(w.projectId()));
        // a folder decides the project when none is named
        ProjectView p = project("Payments");
        Folder f = folders.create("WORKFLOW", 0L, "Flows", p.id());
        Workflow inFolder = workflowService.create(new Workflow(null, "in folder " + u, "", List.of(), List.of(), f.id()));
        assertEquals(p.id(), inFolder.projectId());
        assertThrows(ApiException.class, () -> workflowService.create(new Workflow(null, "mismatch " + u, "", List.of(), List.of(), f.id(), projects.list().stream().filter(x -> !x.id().equals(p.id())).findFirst().orElseThrow().id())),
                "a folder from another project is refused");
    }

    @Test
    void sameNamesAreFineInDifferentProjectsButNotWithinOne() {
        ProjectView a = project("A"), b = project("B");
        folders.create("WORKFLOW", 0L, "E2E", a.id());
        folders.create("WORKFLOW", 0L, "E2E", b.id());
        wf("Smoke " + u, a.id(), null);
        wf("Smoke " + u, b.id(), null);
        assertEquals(409, assertThrows(ApiException.class, () -> folders.create("WORKFLOW", 0L, "E2E", a.id())).status().value());
        assertEquals(409, assertThrows(ApiException.class, () -> wf("Smoke " + u, a.id(), null)).status().value());
        assertEquals(409, assertThrows(ApiException.class, () -> projects.create(new ProjectRequest("A" + u, null))).status().value());
    }

    @Test
    void foldersAndWorkflowsMoveWithinAProjectAndNeverSilentlyAcrossProjects() {
        ProjectView a = project("MoveA"), b = project("MoveB");
        Folder fa = folders.create("WORKFLOW", 0L, "One", a.id()), fa2 = folders.create("WORKFLOW", 0L, "Two", a.id()), fb = folders.create("WORKFLOW", 0L, "Other", b.id());
        Workflow w = wf("Mover " + u, a.id(), fa.id());

        workflowService.move(w.id(), fa2.id());
        assertEquals(fa2.id(), workflowService.get(w.id()).folderId());
        workflowService.move(w.id(), 0L);
        assertEquals(0L, workflowService.get(w.id()).folderId(), "0 = directly in the project");
        assertThrows(ApiException.class, () -> workflowService.move(w.id(), fb.id()), "another project's folder is not a valid target");
        assertEquals(a.id(), workflowService.get(w.id()).projectId());

        // moving a folder under a folder of the same project works; into another project's folder does not
        assertEquals(fa2.id(), folders.update(fa.id(), null, fa2.id()).parentId());
        assertThrows(ApiException.class, () -> folders.update(fa.id(), null, fb.id()));
        // an explicit move to another project works and keeps the id and configuration
        workflowService.move(w.id(), fb.id(), b.id());
        Workflow moved = workflowService.get(w.id());
        assertEquals(b.id(), moved.projectId());
        assertEquals(fb.id(), moved.folderId());
        assertEquals("Mover " + u, moved.name());
        // a name clash in the target is refused instead of overwriting
        Workflow clash = wf("Mover " + u, a.id(), null);
        assertEquals(409, assertThrows(ApiException.class, () -> workflowService.move(clash.id(), 0L, b.id())).status().value());
    }

    @Test
    void deletingAFolderNeverDeletesItsWorkflowsTheyMoveToTheProjectRoot() {
        ProjectView p = project("Del");
        Folder f = folders.create("WORKFLOW", 0L, "Doomed", p.id());
        Folder sub = folders.create("WORKFLOW", f.id(), "Sub", null);
        Workflow w1 = wf("In folder " + u, p.id(), f.id()), w2 = wf("In sub " + u, p.id(), sub.id());
        folders.delete(f.id());
        assertEquals(0, fresh(p).folderCount());
        assertEquals(0L, workflowService.get(w1.id()).folderId());
        assertEquals(0L, workflowService.get(w2.id()).folderId());
        assertEquals(2, fresh(p).workflowCount(), "nothing was deleted");
        assertEquals(p.id(), workflowService.get(w1.id()).projectId());
    }

    @Test
    void aNonEmptyProjectIsOnlyDeletedByMovingItsContentsAndKeepsEveryId() {
        ProjectView from = project("Old"), to = project("New");
        Folder f = folders.create("WORKFLOW", 0L, "Shared name", from.id());
        folders.create("WORKFLOW", 0L, "Shared name", to.id());
        Folder nested = folders.create("WORKFLOW", f.id(), "Inner", null);
        Workflow w = wf("Keep me " + u, from.id(), nested.id());
        Workflow clash = wf("Same " + u, from.id(), null);
        wf("Same " + u, to.id(), null);

        ApiException refused = assertThrows(ApiException.class, () -> projects.delete(from.id(), null));
        assertEquals(409, refused.status().value());
        assertTrue(refused.getMessage().contains("2 workflow(s)"));
        assertThrows(ApiException.class, () -> projects.delete(from.id(), from.id()));
        assertTrue(projectRepo.exists(from.id()), "a refused delete changed nothing");

        projects.delete(from.id(), to.id());

        assertFalse(projectRepo.exists(from.id()));
        Workflow kept = workflowService.get(w.id());
        assertEquals(to.id(), kept.projectId(), "same workflow id, now in the target project");
        assertEquals(nested.id(), kept.folderId(), "its folder moved with it");
        assertEquals(to.id(), folders.get(nested.id()).projectId());
        assertTrue(workflowService.get(clash.id()).name().startsWith("Same " + u + " (from "), "a clashing name is renamed, never overwritten");
        assertTrue(folders.list("WORKFLOW", to.id()).stream().anyMatch(x -> x.name().startsWith("Shared name (from ")));
        assertEquals(3, fresh(to).folderCount());
        assertEquals(3, fresh(to).workflowCount());
        // an empty project just goes
        ProjectView empty = project("Empty");
        projects.delete(empty.id(), null);
        assertFalse(projectRepo.exists(empty.id()));
    }

    @Test
    void renamingAProjectKeepsEverythingInIt() {
        ProjectView p = project("Rename");
        Workflow w = wf("Inside " + u, p.id(), null);
        ProjectView renamed = projects.update(p.id(), new ProjectRequest("Renamed " + u, "new description"));
        assertEquals("Renamed " + u, renamed.name());
        assertEquals("new description", renamed.description());
        assertEquals(1, renamed.workflowCount());
        assertEquals(p.id(), workflowService.get(w.id()).projectId());
        assertThrows(ApiException.class, () -> projects.update(p.id(), new ProjectRequest(" ", null)));
    }

    @Test
    void workflowsReportTheirLastRunAndLastChange() {
        ProjectView p = project("Runs");
        SavedQuery q = library.create(new SavedQuery(null, "runs-q" + u, "", "T", "SELECT 1 AS one", QueryType.READ, List.of(), true, List.of()));
        Workflow never = wf("Never run " + u, p.id(), null);
        Workflow ran = workflowService.create(new Workflow(null, "Ran " + u, "", List.of(), List.of(
                new WorkflowStep(null, 1, "one", null, q.id(), null, List.of(), 0, 0, false, List.of(), List.of())), null, p.id()));
        assertNull(workflowService.get(never.id()).lastStatus(), "never executed");
        assertNull(workflowService.get(never.id()).lastRunAt());
        assertNotNull(workflowService.get(never.id()).updatedAt());
        executor.runNow(ran.id(), Map.of(), null, null);
        Workflow after = workflowService.get(ran.id());
        assertEquals("SUCCESS", after.lastStatus());
        assertNotNull(after.lastRunAt());
    }

    @Test
    void migrationMovesLegacyWorkflowsAndFoldersIntoTheDefaultProjectKeepingIdsAndHistory() {
        // rows exactly as an older version stored them: no project
        meta.update("INSERT INTO folder (kind, parent_id, name, project_id) VALUES ('WORKFLOW', 0, ?, 0)", "Legacy Main " + u);
        long folderId = meta.queryForObject("SELECT id FROM folder WHERE name = ?", Long.class, "Legacy Main " + u);
        meta.update("INSERT INTO folder (kind, parent_id, name, project_id) VALUES ('WORKFLOW', ?, ?, 0)", folderId, "Legacy Child " + u);
        meta.update("INSERT INTO workflow (name, description, folder_id, project_id) VALUES (?, 'old flow', ?, 0)", "Legacy WF " + u, folderId);
        long wid = meta.queryForObject("SELECT id FROM workflow WHERE name = ?", Long.class, "Legacy WF " + u);
        meta.update("INSERT INTO workflow_input (workflow_id, input_order, name, label, param_type, required) VALUES (?,0,'customerId','Customer','STRING',TRUE)", wid);
        String runId = UUID.randomUUID().toString();
        meta.update("INSERT INTO workflow_run (id, workflow_id, workflow_name, status, started_at, finished_at, duration_ms) VALUES (?,?,?,'FAILED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,5)", runId, wid, "Legacy WF " + u);

        migration.migrate();
        migration.migrate(); // idempotent

        long def = projectRepo.defaultProjectId();
        Workflow w = workflowService.get(wid);
        assertEquals(wid, w.id(), "workflow id unchanged");
        assertEquals(def, w.projectId());
        assertEquals(folderId, w.folderId(), "still in the same folder");
        assertEquals("old flow", w.description());
        assertEquals("customerId", w.inputs().get(0).name(), "configuration intact");
        assertEquals(def, folders.get(folderId).projectId());
        assertTrue(folders.list("WORKFLOW", def).stream().anyMatch(f -> f.name().equals("Legacy Child " + u)), "sub-folders migrate too");
        assertEquals("FAILED", w.lastStatus(), "run history still attached to the same workflow id");
        assertEquals(1, meta.queryForObject("SELECT COUNT(*) FROM workflow_run WHERE id = ? AND workflow_id = ?", Integer.class, runId, wid));
        // the old global/per-parent uniqueness is gone: the same names can be reused in another project
        ProjectView other = project("After migration");
        folders.create("WORKFLOW", 0L, "Legacy Main " + u, other.id());
        wf("Legacy WF " + u, other.id(), null);
    }
}
