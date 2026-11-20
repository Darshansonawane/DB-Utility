# Architecture

```
React (Vite, MUI, Monaco)        runs in the browser, talks only to the backend
        |  REST /api/**  (header X-QA-Utility, CORS limited to the local UI)
Spring Boot 3 / Java 21          127.0.0.1:8080 only
        |-- Generic SQL engine   validate -> typed PreparedStatement -> timeout/limits -> history + audit
        |-- Query library        saved queries + parameter definitions (the allowlist)
        |-- Workflow engine      steps = saved queries, parameter mappings between steps
        |-- Metadata store       embedded H2 file DB (~/.qa-database-utility), schema: database/metadata-schema.sql
        |-- Connection registry  many live connections per browser session (MySQL pools + MongoDB clients), one "active" per type
        '-- Database adapters    MySqlAdapter (Hikari/JDBC), MongoAdapter (MongoDB sync driver): open, probe, close
```

## Connections (MySQL + MongoDB)

- `ConnectionService` manages saved profiles; every connect/test/edit/delete first verifies that connection's **access password** (`AccessPasswordService`).
- `DbAdapter` (one per type) opens real connections. `ConnectionRegistry` holds them keyed by (browser session, profile): each has its own pool/client, so one failing or being closed never affects another. The session id is an anonymous HttpOnly cookie (`SessionFilter`/`SessionContext`); background threads (workflows) re-bind the starting session.
- Per session, one connection per type is **active**: `SessionTargetProvider` (MySQL) and `SessionMongoProvider` (MongoDB) give the SQL engine, workflows and metadata tools that connection. `Connect` makes the new connection active; `Use` switches without disconnecting anything.
- Editing or deleting a connection closes only that connection (in every session).
- **Database discovery:** a connection needs no database name. After connecting, `LiveConnection.discoverDatabases()` asks the server what that connection's own database user may access (MySQL `SHOW DATABASES`; MongoDB `listDatabases` with `authorizedDatabases`), hides system schemas and production-looking names, and the user picks one (`selectDatabase`). If a server refuses to list databases, the list is flagged `restricted` and a name can be typed; the server still enforces permissions on every query.
- Environments are QA, STAGING (formerly UAT, migrated at startup) and DEV (shown as Development).
- Saved queries have an `engine`. `MYSQL`: SQL as before. `MONGODB`: `sql` holds a JSON spec run by `MongoExecutionService` (read-only; "?" strings are typed parameters). Both return the same `QueryResult`, so forms, workflows, outputs and variable extraction are unchanged.

## Workflow Manager hierarchy: Projects → Folders → Workflows

- A **project** (`project` table) is an application, product or business domain. Every workflow has a `project_id`; every workflow folder has a `project_id`; a workflow may sit in a folder (`folder_id`, 0 = directly in the project). Folders nest (up to 8 levels) and always belong to their parent's project.
- Names are unique **per project** (folders per parent, workflows per project), so two projects can both have an "E2E Automation" folder.
- Moves: a workflow moves between folders of its project, or to another project (name clash refused); a folder moves only within its project. Deleting a folder never deletes workflows: they move to the top level of the project. A non-empty project is deleted only by moving its folders and workflows to another project (a clashing name arriving there is renamed, never overwritten).
- `Workflow` carries read-only `updatedAt`, `lastStatus` and `lastRunAt` (from `workflow_run`) so the UI can show the last execution without extra calls.
- **Migration** (`ProjectMigration`, runs on every start, idempotent): replaces the old unique constraints with per-project ones, creates "Default Project" if needed and moves every workflow and workflow folder that has no project into it. Ids, steps, mappings and run history are not touched.
- There are no user accounts, so projects share the model workflows already had (shared, not per-user). Connections remain per browser session and protected by their access password.

## Why there are no per-query endpoints or components

| Concern | Generic mechanism |
|---|---|
| Run any SQL | `POST /api/sql/execute`, `/preview`, `/analyze` |
| Run any saved query | `POST /api/queries/{id}/execute`, `/preview` |
| Input forms | `DynamicForm` renders controls from `QueryParameter {name,label,type,required,default}` |
| Multi-step flows | `WorkflowExecutor` resolves each step's parameters from inputs / earlier outputs / constants / manual overrides |
| Add a new query | Save it in the UI (or SQL Editor -> Save). No Java or React change. |

## Endpoints

| Area | Endpoints |
|---|---|
| Connections | `GET/POST /api/connections`, `PUT/DELETE /api/connections/{id}`, `POST /api/connections/test`, `/{id}/test`, `/{id}/connect` (body `{accessPassword}`), `/{id}/disconnect`, `/{id}/activate`, `/{id}/access-password` (legacy connections only), `/disconnect` (all of this session), `GET /status` (active MySQL), `GET /statuses` (every live connection) |
| Databases | `GET /api/connections/databases?dbType=MYSQL\|MONGODB` (what the active connection's database user may access), `POST /api/connections/database` `{name, dbType}` (switch, no reconnect) |
| MongoDB | `POST /api/mongo/analyze` (validate a JSON query, suggest parameters), `GET /api/mongo/collections` |
| SQL | `POST /api/sql/analyze`, `/execute`, `/preview` |
| Query library | `GET/POST /api/queries`, `GET/PUT/DELETE /{id}`, `/{id}/duplicate`, `/{id}/enabled`, `/{id}/preview`, `/{id}/execute`, `/categories` |
| Metadata | `GET /api/metadata/schemas`, `/schemas/{s}/tables`, `/tables/{t}`, `/columns/{c}/values`, `/sample` |
| Projects | `GET/POST /api/projects`, `GET/PUT /api/projects/{id}`, `DELETE /api/projects/{id}?moveTo=<projectId>` (needed when the project is not empty) |
| Workflow folders | `GET /api/folders?kind=WORKFLOW[&projectId=]`, `POST /api/folders` (`projectId` for a top-level folder), `PUT/DELETE /api/folders/{id}` |
| Workflows | `GET/POST /api/workflows`, `PUT/DELETE /{id}`, `POST /{id}/runs`, `GET /api/workflow-runs/{runId}`, `POST /{runId}/execute`, `/{runId}/stop` |
| History | `GET /api/history/executions`, `/workflow-runs`, `/workflow-runs/{id}`, `/audit` |
| Other | `GET /api/dashboard`, `GET/PUT /api/settings` |

## Write flow (INSERT / UPDATE / DELETE)

1. Statement validated (single statement, no DDL, UPDATE/DELETE need a top-level `WHERE`).
2. **Preview**: for single-table UPDATE/DELETE the engine derives a `SELECT` of the target rows and a count, and lists the proposed `SET` values. For statements it cannot decompose it runs a dry run inside a transaction that is rolled back (reliable for InnoDB). Nothing changes.
3. If read-only mode is on, ad-hoc writes are disabled (for editor SQL), or the count exceeds the affected-row limit, the preview is returned as **blocked** and no confirmation token is issued.
4. Otherwise a **single-use token** (5 min TTL) is issued, bound to the exact SQL + parameter values + connection.
5. **Execute** needs that token. It runs in a transaction, rolls back if rows exceed the limit, and commits otherwise.
6. `audit_log` records preview, rejection and execution (SQL with placeholders, masked parameters, rows affected).

## Workflow engine rules

- Step parameters resolve in this order: manual override, mapping (INPUT / STEP_OUTPUT / CONSTANT), default value.
- STEP_OUTPUT reads a named output alias, or a raw column, from the **first row** of the upstream step.
- A step with a missing required value, or whose declared dependency did not complete, is `BLOCKED` and not executed. A query that returns zero rows is `NO_DATA` (shown as a missing record), and dependents needing its values are blocked.
- Re-running a step puts everything downstream of it back to `PENDING` (its outputs may have changed).
- Retries apply to SQL execution failures only. `stopOnFailure` skips the remaining selected steps. Stop takes effect after the current step.
- Workflow steps run **SELECT, INSERT, UPDATE and DELETE** directly (MySQL). There is no workflow-level write permission, preview or confirmation: the configured database user's privileges are the only authority, and the database's own error (for example `UPDATE command denied`) is reported on the step. The statement checks (single statement, `WHERE` required for UPDATE/DELETE), the transaction, the affected-row limit and the audit record still apply. A write that affects 0 rows is shown as `NO_DATA`; rows changed are recorded in the run history. MongoDB queries stay read-only.
- Live results (values and rows) are held in memory for the last 50 runs. Persisted history keeps masked identifiers, statuses, timings and counts, never row data.

## Metadata tables

`project`, `connection_profile` (now with `db_type`, `owner_name`, `access_password_hash`, `uri_encrypted`, `auth_database`, `tls`), `saved_query` (now with `engine`), `query_parameter`, `workflow`, `workflow_input`, `workflow_step`, `workflow_param_mapping`, `execution_history`, `workflow_run`, `workflow_step_run`, `audit_log`, `app_setting`. See [`database/metadata-schema.sql`](../database/metadata-schema.sql). The same script works on MySQL 8 if you prefer a dedicated metadata schema.
