# DB-Utility

A local web tool for banking QA: connect to **QA/Staging/Development** MySQL and MongoDB databases (several at once, each protected by its own access password) over your VPN, save SQL once, and run it from generated forms, with previewed and audited writes, multi-step workflows and automatic ID passing.

- **One generic engine**: no per-query REST endpoints or React components. Save a query with its parameter definitions and the form appears.
- **Projects → Folders → Workflows**: organise automation by application; workflow steps can run SELECT, INSERT, UPDATE and DELETE under the database user's privileges.
- **Savings Wallet workflow** (7 read-only steps) is seeded on first start.
- **Safe by default**: read-only mode, parameterised SQL, preview + confirmation + row limit + audit for every write.

| | |
|---|---|
| Backend | Java 21, Spring Boot 3.3, Spring JDBC, MySQL Connector/J, MongoDB Java driver (`backend/`) |
| Frontend | React 18, TypeScript, Vite, MUI, Axios, React Router, Monaco (`frontend/`) |
| Metadata | Embedded H2 file DB, script in `database/metadata-schema.sql` |

## Quick start

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
cd backend && mvn spring-boot:run          # terminal 1
cd frontend && npm install && npm run dev  # terminal 2  -> http://127.0.0.1:5173
```

Full instructions: [docs/setup-guide.md](docs/setup-guide.md). Design: [docs/architecture.md](docs/architecture.md). Controls and limits: [docs/security-guide.md](docs/security-guide.md).

## Pending your confirmation (deliberately not implemented)

- **Write operations for the Savings Wallet flow** (debit instruction date, ContributionDate, schedule date restore, payment master previous date, wallet status): no UPDATE statements were supplied. Use **Savings Wallet Workflow -> Schema inspector** to view real columns, types, keys, current values and distinct status values, then confirm the statements.
- **One-month-back filter on Step 1**: the SQL has no date filter and the date column is not known. The Date Management tab asks you to choose the schedule date column instead of assuming one.
- **Assumed workflow output columns**: Step 2 -> `client_unique_id`, Step 5 -> `id` (payment master id). Both are editable in Workflow Manager and overridable per run.

## More
- [API / SQL / variable automation guide](docs/automation-guide.md)
