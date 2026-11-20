# Security guide

This tool changes banking QA/UAT data. These controls exist, and so do their limits.

## Controls implemented

| Control | How |
|---|---|
| QA/UAT only | `qa-utility.allowed-environments` (default `QA,UAT`). Host/database names containing `prod`, `prd`, `production`, `live` (`qa-utility.blocked-host-patterns`) are rejected. This is a name-based guard, not proof: also use accounts that exist only in QA/UAT. |
| No VPN/firewall bypass | The backend opens a normal JDBC connection from your Mac. If the VPN is down, the connection fails. |
| Credentials stay on the backend | Database passwords and MongoDB connection strings are **envelope-encrypted** (AES-256-GCM: a fresh random data key per value, wrapped by the master key; format `v2:`). Master key: `QA_UTILITY_MASTER_KEY` env var, or a generated `~/.qa-database-utility/master.key` (mode 0600). Secrets are never returned by any API and never written to logs, history or audit. Values stored by older versions stay readable. To use a managed key service, replace `CryptoService.wrap/unwrap`. |
| Per-connection access password | Every connection has its own **access password**, chosen when it is created (separate from the database username/password). It is required to connect to, test, edit or delete that connection. Only a salted PBKDF2-HMAC-SHA256 hash (210k iterations) is stored. 5 wrong guesses lock that connection for 60 s. Connections created before this existed must get an access password the first time someone opens them. |
| Browser-session isolation | There is no login. Each browser gets an anonymous random session cookie (`QA_SID`, HttpOnly, SameSite=Strict; set `qa-utility.cookie-secure=true` behind HTTPS). Live connections belong to the session that unlocked them: another person on the same server cannot use them, even though they can see the connection names. Workflow runs are visible only to the session that started them. |
| Not committed to Git | `.gitignore` excludes `.qa-database-utility/`, `*.mv.db`, `master.key`, `.env`. No credentials in `application.properties`. |
| Local-only API | Binds to `127.0.0.1`. CORS only allows `localhost:5173`. Every `/api` call needs the `X-QA-Utility` header (CSRF defence). There is no login: anyone who can reach port 8080 on your machine can use the tool, so do not expose it. |
| Parameterised SQL | Every value is bound with `PreparedStatement.setObject` after typed conversion (STRING, INTEGER, DECIMAL, DATE, DATETIME, BOOLEAN). Values are never concatenated into SQL. |
| SQL validation | One statement only; comments are stripped; `/*! */` executable comments, `INTO OUTFILE/DUMPFILE`, `LOAD_FILE`, `LOAD DATA`, `SLEEP`, `BENCHMARK`, `GET_LOCK`, `FOR UPDATE` are blocked; only SELECT/INSERT/UPDATE/DELETE (plus read-only SHOW/DESCRIBE/EXPLAIN); UPDATE/DELETE need a top-level `WHERE`. |
| Allowlisting | Saved, enabled queries are the allowlist. Ad-hoc editor writes are off by default (setting). Per-query environment restriction. |
| Read-only by default | Settings: read-only mode ON blocks all writes. Reads run on a connection marked read-only. |
| Write safeguards | Preview of target rows and proposed values, single-use confirmation token bound to the exact statement, affected-row limit (default 10) enforced at preview and execution (rollback), transaction boundary, audit record. |
| Timeouts and limits | Query timeout (default 30 s) and result row limit (default 500), both with hard ceilings in `application.properties`. |
| Audit and masking | `audit_log` (previews, rejections, executions, connects, settings changes, query/workflow edits). Identifiers in history and audit are masked (first/last two characters). Row data is not stored in history. |

## Known limits (be aware)

- The access password protects *using* a connection; anyone who knows it can use it. The connection list (name, host, database, owner) is visible to everyone who can reach the server. Lock-out after repeated wrong guesses is per connection, so someone guessing can also temporarily block the owner.
- MongoDB queries are read-only (find, count, aggregate, distinct); `$where`, `$function`, `$accumulator`, `$out` and `$merge` are rejected. Connection strings with `tlsInsecure`, `tlsAllowInvalidCertificates` or `tlsAllowInvalidHostnames` are refused.
- **Least privilege is your best control.** The validator is lexical, not a full SQL parser. Use a database account that has only the SELECT (and, if needed, narrowly scoped UPDATE) grants required, and no DDL, no FILE privilege.
- A committed write is not undone by this tool. Rollback happens only when the limit is exceeded or the statement errors.
- Dry-run previews for complex statements rely on transaction rollback, which is reliable for InnoDB only.
- Error messages from MySQL (for example duplicate-key errors) can contain data values and are stored in history as returned.
- The embedded metadata database has no password beyond the file permissions of your user account.
- The default JDBC URL uses `sslMode=PREFERRED`. If your server requires a stricter mode or `allowPublicKeyRetrieval`, change `ActiveConnectionManager.jdbcUrl`.
