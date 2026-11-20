package com.qa.utility.project;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Upgrades an existing metadata store to Project -> Folders -> Workflows without losing anything:
 * <ol>
 *   <li>folder and workflow names become unique <em>per project</em> (the old global/per-parent uniqueness would stop two projects from
 *       having a folder or workflow with the same name);</li>
 *   <li>every workflow and workflow-folder that has no project yet is moved into the "Default Project", created if needed.</li>
 * </ol>
 * Ids, configuration, steps and run history are never touched. Safe to run on every start.
 */
@Component
public class ProjectMigration {
    private static final Logger log = LoggerFactory.getLogger(ProjectMigration.class);
    private final JdbcTemplate jdbc;
    private final ProjectRepository projects;

    public ProjectMigration(JdbcTemplate jdbc, ProjectRepository projects) {
        this.jdbc = jdbc;
        this.projects = projects;
    }

    @PostConstruct
    public void migrate() {
        dropOldUniqueConstraints("FOLDER");
        dropOldUniqueConstraints("WORKFLOW");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_folder_scope ON folder (kind, project_id, parent_id, name)");
        jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_workflow_project_name ON workflow (project_id, name)");

        Integer orphanWorkflows = jdbc.queryForObject("SELECT COUNT(*) FROM workflow WHERE project_id = 0", Integer.class);
        Integer orphanFolders = jdbc.queryForObject("SELECT COUNT(*) FROM folder WHERE kind = 'WORKFLOW' AND project_id = 0", Integer.class);
        if ((orphanWorkflows != null && orphanWorkflows > 0) || (orphanFolders != null && orphanFolders > 0)) {
            long pid = projects.defaultProjectId();
            jdbc.update("UPDATE folder SET project_id = ? WHERE kind = 'WORKFLOW' AND project_id = 0", pid);
            jdbc.update("UPDATE workflow SET project_id = ? WHERE project_id = 0", pid);
            log.info("Moved {} workflow(s) and {} workflow folder(s) into the default project", orphanWorkflows, orphanFolders);
        }
    }

    private void dropOldUniqueConstraints(String table) {
        List<String> names = jdbc.queryForList("SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE UPPER(TABLE_NAME) = ? AND CONSTRAINT_TYPE = 'UNIQUE'",
                String.class, table);
        for (String n : names) jdbc.execute("ALTER TABLE " + table + " DROP CONSTRAINT \"" + n + "\"");
    }
}
