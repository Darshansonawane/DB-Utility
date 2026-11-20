# Setup guide (macOS)

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| JDK | 21 | `brew install openjdk@21` |
| Maven | 3.9+ | `brew install maven` |
| Node.js | 18+ (tested 25) | `brew install node` |
| VPN | your company VPN | connect before using a QA/UAT profile |

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

## Run

Terminal 1, backend:

```bash
cd backend
mvn spring-boot:run
```

Terminal 2, frontend:

```bash
cd frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173.

On first start the backend creates `~/.qa-database-utility/` (metadata DB and encryption key) and seeds the seven Savings Wallet queries and the Savings Wallet workflow.

## First use

1. **Database Connections -> New connection.** Choose the database type (MySQL or MongoDB) and environment (QA, UAT or Development). MySQL: host, port, database, username, password. MongoDB: host and port, or a connection string (`mongodb://...` / `mongodb+srv://...`), database, optional username/password, authentication database and TLS. Choose an **access password** for the connection (needed later to connect, test, edit or delete it). Click **Test connection**, save, then **Connect**. You can connect several connections of both types at once; **Use** picks which one queries run on.
2. **SQL Editor** or **Saved Queries** to run SELECTs. Writes are blocked until you turn read-only mode off in **Settings**.
3. **Savings Wallet Workflow**: enter Customer ID and Savings Wallet Contributor ID, click **Fetch All Details**.

## Optional configuration

| Setting | Where |
|---|---|
| Master key from your own secret | `export QA_UTILITY_MASTER_KEY='<long random string>'` before starting the backend. Changing it makes stored passwords unreadable, so re-enter them. |
| Different data folder | `--qa-utility.data-dir=/path` |
| Allowed environments / blocked host patterns | `qa-utility.allowed-environments`, `qa-utility.blocked-host-patterns` in `application.properties` |
| Dedicated MySQL metadata schema | `CREATE DATABASE qa_utility_meta;` then set `spring.datasource.url/username/password` (use env vars), and remove the H2 URL. `database/metadata-schema.sql` runs automatically. |

Existing connections from an earlier version keep working after the upgrade, but the first time you connect to one you are asked to choose its access password.

MongoDB queries: Saved Queries -> New query -> Database type **MongoDB**, for example `{"collection":"customers","filter":{"customerId":"?"},"limit":50}`. Operations: find, count, aggregate, distinct (read-only).

For a shared server set `qa-utility.cookie-secure=true` (HTTPS only), a strong `QA_UTILITY_MASTER_KEY`, and put the app behind your company TLS terminator. `qa-utility.session-idle-minutes` (default 480) closes the live connections of an idle browser session.

## Tests and builds

```bash
cd backend && mvn test            # JUnit 5 + Mockito + Spring Boot Test, isolated in-memory H2 target
# optional: real-server integration tests (throw-away MongoDB with auth + MySQL), skipped unless these are set:
#   MONGO_TEST_PORT MONGO_TEST_USER MONGO_TEST_PASSWORD   (database qa_customers, authSource admin)
#   MYSQL_TEST_PORT MYSQL_TEST_USER MYSQL_TEST_PASSWORD   (database bank_wallet, table customers)
cd frontend && npm test           # Vitest + Testing Library
cd frontend && npm run build      # type-check + production bundle
```

Tests never connect to a company database.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Cannot reach the backend" in the UI | Backend not running on 127.0.0.1:8080 |
| "Public Key Retrieval is not allowed" | MySQL 8 account using `caching_sha2_password` over a non-TLS link. Enable TLS on the server, or adapt the JDBC URL knowingly. |
| "Communications link failure" | VPN down, wrong host/port, or firewall |
| "Not connected" when running | Connect a profile first (the status chip in the top bar shows the active one) |
| Stored passwords unreadable | Master key changed or `master.key` deleted: re-enter passwords |
