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

1. **Database Connections -> New connection.** Choose QA or UAT, enter host, port, database, username and password. Click **Test connection**, save, then **Connect**.
2. **SQL Editor** or **Saved Queries** to run SELECTs. Writes are blocked until you turn read-only mode off in **Settings**.
3. **Savings Wallet Workflow**: enter Customer ID and Savings Wallet Contributor ID, click **Fetch All Details**.

## Optional configuration

| Setting | Where |
|---|---|
| Master key from your own secret | `export QA_UTILITY_MASTER_KEY='<long random string>'` before starting the backend. Changing it makes stored passwords unreadable, so re-enter them. |
| Different data folder | `--qa-utility.data-dir=/path` |
| Allowed environments / blocked host patterns | `qa-utility.allowed-environments`, `qa-utility.blocked-host-patterns` in `application.properties` |
| Dedicated MySQL metadata schema | `CREATE DATABASE qa_utility_meta;` then set `spring.datasource.url/username/password` (use env vars), and remove the H2 URL. `database/metadata-schema.sql` runs automatically. |

## Tests and builds

```bash
cd backend && mvn test            # JUnit 5 + Mockito + Spring Boot Test, isolated in-memory H2 target
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
