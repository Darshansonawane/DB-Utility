# HelloDB Hub – API, SQL and variable automation

## Where things are
| Area | What it does |
|---|---|
| API Manager → **Requests Storage** | Saved API requests in nested folders (module / feature). Import from cURL, pre-request JavaScript, extraction rules. |
| API Manager → **API Workflows** | Ordered **API** and **SQL** steps with wait / polling / assertions. Run many at once. Folder organised. |
| API Manager → **Runs / Reports** | Live runs, history (clear all or selected), per-workflow reports + CSV. |
| API Manager → **Variables** | One store for API-extracted, SQL-extracted and manual values. Folders + scopes. |
| **Workflow Manager** | DB workflows; a step may be a DB query *or* an API request. |
| **All-in-One Information** | Folder-organised Markdown pages (modules, APIs, tables, runbooks). |

Folders only organise: deleting a folder never deletes what is inside, items move to **Unfiled**.
(A folder holding folder-scoped variables cannot be deleted until those are moved or removed.)

## API response → SQL → variable → anything
1. Send a request. Under the response, tick the fields to keep (e.g. `data.displayAccountNumber`), name them, choose the
   Variables folder, and optionally *remember as extraction rules* so every run repeats it.
2. Open the saved query (Queries Manager). Set the parameter's **Default / mapped variable** to `{{displayAccountNumber}}`.
   The runner shows **Parameter values (resolved before running)**; a missing variable is reported before any SQL runs.
   The value is bound as a JDBC parameter, never concatenated into the SQL.
3. In the query's **Save result values as variables** add `id → savingsWalletDetailsId` (folder Savings). After each run the
   first result row is saved (or tick columns of a result and *Save as variables*).
4. Use `{{savingsWalletDetailsId}}` in API request URL/headers/body, pre-request scripts, other query parameters,
   DB-workflow values, and API-workflow steps (including SQL steps).

## Variable scopes and precedence
`{{name}}` resolves, most specific first: **this run** → **folder-level** (the request/workflow's folder and its parents) →
**environment** (QA/Staging/Development, chosen with *Active environment*) → **global**.
Global names are unique. Extractions and scripts write **global** variables (or the run's private scope when a workflow does
not publish globally). Secrets are encrypted at rest and masked in the UI, previews, logs and history.
Built-ins: `{{$uuid}} {{$timestamp}} {{$isoDate(+7)}} {{$randomInt(1,100)}} {{$randomString(8)}} {{$randomNumeric(10)}}`.

## SQL steps in API workflows
Read-only saved queries only. Parameters come from the step's values (or the query's default / mapped variable). With
*Max attempts* > 1 the step polls until a row exists; the query's extraction rules are applied to the first row. A missing
variable or a missing column fails the step immediately with a clear message. Needs an active QA/Staging/Development connection.

## Workflow Manager: micro flows inside big flows
A workflow step is a **DB query**, an **API request** or **another workflow** (*Add workflow*). The nested workflow's inputs are
mapped like query parameters (workflow input / earlier step output / constant / `{{variable}}`), it shares the parent's database
connection and variables, and the outputs of all its steps become the parent step's outputs, so micro flows can pass values on
to the next micro flow. A failing micro flow fails its parent step (the parent's *Stop on failure* decides what happens next);
*Stop* on the parent also stops the nested one. A workflow cannot contain itself (directly or in a loop), nesting is limited to
5 levels, and a workflow used inside another cannot be deleted until it is removed there. Workflow folders use a file-explorer
style browser (breadcrumbs, folder cards, drag a workflow onto a folder); suggested top-level folders: *Main Business Flows*
and *Micro Business Flows*.

## Runtime inputs and flexible variables
When you click **Run** on a workflow, the dialog opens an **optional** *Runtime inputs* form. Nothing in it has to be filled in.
- **Workflow inputs** (text, number, date, date & time, yes/no) can have a **default**; it is pre-filled and used when the field is empty.
- Each step lists its parameters with their type, whether they are required, and where the value comes from: **Automatic** (an earlier step's output), a **workflow input**, a **constant**, a **default**, or *not provided*. Type into a field to override that one value **for this run only**.
- Resolution order: **runtime override → automatic value → default → empty (if optional)**. Only a genuinely required value that is nowhere to be found blocks a step, and only that step. Required inputs are never a reason to refuse the whole run.
- **Save as defaults** is the only way run-time values change the workflow.
- **Outputs are optional.** Every API and database response is kept for the run. Reference any part of it with a path (`data.items.0.id`, `rows.1.id`) in a mapping, or write `{{step2.data.wallet.id}}` anywhere a `{{variable}}` is allowed.

## History
Each API workflow run stores per-step status, attempts, HTTP status, timings and the extracted variable names/values
(secrets masked); failed steps also keep a response snippet. **Clear history** removes run records only: requests, workflows,
queries and variables are untouched, and runs in progress are kept.

## Upgrading
Starting the new version upgrades the metadata store in place (variables keep their values and become global variables,
requests and workflows are unfiled). No manual steps.
