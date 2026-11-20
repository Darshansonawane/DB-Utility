-- QA Database Utility: application metadata schema.
-- Runs automatically at startup against the embedded H2 metadata store (MySQL mode).
-- It is also valid MySQL 8: to use a dedicated MySQL metadata schema instead, create an empty
-- database (e.g. CREATE DATABASE qa_utility_meta;) and point spring.datasource.* at it.
-- This script never touches banking business tables.

CREATE TABLE IF NOT EXISTS connection_profile (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  environment VARCHAR(20) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  database_name VARCHAR(128) NOT NULL,
  username VARCHAR(128) NOT NULL,
  password_encrypted VARCHAR(1024) NOT NULL,   -- AES-256-GCM, never plaintext
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saved_query (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  description VARCHAR(1000),
  category VARCHAR(100),
  sql_text TEXT NOT NULL,
  query_type VARCHAR(10) NOT NULL,             -- READ | WRITE
  environments VARCHAR(100),                   -- comma separated; empty = all approved environments
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Added later: per-query target database (upgrades an existing H2 metadata store in place).
ALTER TABLE saved_query ADD COLUMN IF NOT EXISTS database_name VARCHAR(64);

CREATE TABLE IF NOT EXISTS query_parameter (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  query_id BIGINT NOT NULL,
  param_order INT NOT NULL,                    -- i-th "?" placeholder in the SQL
  name VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  param_type VARCHAR(20) NOT NULL,             -- STRING | INTEGER | DECIMAL | DATE | DATETIME | BOOLEAN
  required BOOLEAN NOT NULL DEFAULT TRUE,
  default_value VARCHAR(500),
  FOREIGN KEY (query_id) REFERENCES saved_query(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  description VARCHAR(1000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_input (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workflow_id BIGINT NOT NULL,
  input_order INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  label VARCHAR(200) NOT NULL,
  param_type VARCHAR(20) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workflow_step (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workflow_id BIGINT NOT NULL,
  step_order INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  description VARCHAR(1000),
  query_id BIGINT NOT NULL,
  depends_on VARCHAR(200),                     -- comma separated step_order values
  retry_count INT NOT NULL DEFAULT 0,
  retry_delay_ms INT NOT NULL DEFAULT 500,
  stop_on_failure BOOLEAN NOT NULL DEFAULT FALSE,
  output_fields VARCHAR(1000),                 -- alias=COLUMN,alias2=COLUMN2 (read from first result row)
  FOREIGN KEY (workflow_id) REFERENCES workflow(id) ON DELETE CASCADE,
  FOREIGN KEY (query_id) REFERENCES saved_query(id)
);

-- Hybrid workflows: a step is either a saved DB query or a saved API request (upgrades an existing store in place).
ALTER TABLE workflow_step ALTER COLUMN query_id SET NULL;
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS step_type VARCHAR(20) DEFAULT 'QUERY' NOT NULL;
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS api_request_id BIGINT;
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS api_options_json TEXT;
-- Variables a workflow step saves from the first result row (JSON list of {variable, column, secret, folderId}).
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS save_variables_json TEXT;
-- Optional hold before a step (JSON {waitSeconds, manualResume}).
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS pause_json TEXT;

CREATE TABLE IF NOT EXISTS workflow_param_mapping (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  step_id BIGINT NOT NULL,
  param_name VARCHAR(100) NOT NULL,
  source_type VARCHAR(20) NOT NULL,            -- INPUT | STEP_OUTPUT | CONSTANT
  source_ref VARCHAR(100),                     -- input name, or upstream step_order
  source_field VARCHAR(100),                   -- output alias / column of upstream step
  constant_value VARCHAR(500),
  FOREIGN KEY (step_id) REFERENCES workflow_step(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS execution_history (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,                   -- SQL_EDITOR | SAVED_QUERY | WORKFLOW_STEP
  query_id BIGINT,
  query_name VARCHAR(200),
  sql_text TEXT,                               -- placeholders only, parameter values are never stored in SQL
  connection_name VARCHAR(100),
  environment VARCHAR(20),
  status VARCHAR(20) NOT NULL,                 -- SUCCESS | FAILED
  duration_ms BIGINT,
  rows_returned INT,
  rows_affected INT,
  error_message VARCHAR(2000),
  params_masked VARCHAR(2000),
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_run (
  id VARCHAR(36) PRIMARY KEY,
  workflow_id BIGINT,
  workflow_name VARCHAR(200),
  status VARCHAR(20) NOT NULL,
  customer_id_masked VARCHAR(100),
  contributor_id_masked VARCHAR(100),
  client_unique_id_masked VARCHAR(100),
  payment_master_id_masked VARCHAR(100),
  inputs_masked VARCHAR(2000),
  connection_name VARCHAR(100),
  environment VARCHAR(20),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  duration_ms BIGINT,
  failed_steps VARCHAR(500),
  rows_affected INT DEFAULT 0,
  operations VARCHAR(1000),
  error_message VARCHAR(2000)
);

CREATE TABLE IF NOT EXISTS workflow_step_run (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(36) NOT NULL,
  step_order INT NOT NULL,
  step_name VARCHAR(200),
  status VARCHAR(20) NOT NULL,                 -- SUCCESS | NO_DATA | FAILED | BLOCKED | STOPPED | SKIPPED
  duration_ms BIGINT,
  attempts INT,
  rows_returned INT,
  rows_affected INT,
  inputs_masked VARCHAR(2000),
  error_message VARCHAR(2000),
  executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES workflow_run(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  action VARCHAR(50) NOT NULL,                 -- WRITE_PREVIEW | WRITE_EXECUTE | WRITE_REJECTED | CONNECT | ...
  actor VARCHAR(100),
  connection_name VARCHAR(100),
  environment VARCHAR(20),
  sql_text TEXT,
  params_masked VARCHAR(2000),
  rows_affected INT,
  status VARCHAR(20),
  detail VARCHAR(2000)
);

CREATE TABLE IF NOT EXISTS app_setting (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value VARCHAR(500)
);


-- ---------------------------------------------------------------- API automation module
CREATE TABLE IF NOT EXISTS api_request (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  description VARCHAR(1000),
  method VARCHAR(10) NOT NULL,
  url VARCHAR(2000) NOT NULL,
  headers_json TEXT,
  body_text TEXT,
  extractions_json TEXT,
  expected_status INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_variable (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  value_text TEXT,                              -- AES-GCM encrypted when secret = TRUE
  secret BOOLEAN NOT NULL DEFAULT FALSE,
  source VARCHAR(200),                          -- api:<request> | sql:<query> | script | manual
  scope VARCHAR(12) NOT NULL DEFAULT 'GLOBAL',  -- GLOBAL | FOLDER | ENVIRONMENT
  scope_key VARCHAR(40) NOT NULL DEFAULT '',    -- '' | F<folderId> | E<environment>  (makes (name, scope, scope_key) unique)
  folder_id BIGINT NOT NULL DEFAULT 0,          -- organising folder; for FOLDER scope also the visibility folder
  environment VARCHAR(10) NOT NULL DEFAULT '',  -- QA | STAGING | DEV for ENVIRONMENT scope
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API workflows: ordered API steps with wait / poll / assertions, run asynchronously and reported per workflow.
-- Pre-request JavaScript (runs in a sandbox before the request is built; upgrades an existing store in place).
ALTER TABLE api_request ADD COLUMN IF NOT EXISTS pre_script TEXT;

CREATE TABLE IF NOT EXISTS api_workflow (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL UNIQUE,
  description VARCHAR(1000),
  publish_global BOOLEAN NOT NULL DEFAULT TRUE,   -- copy extracted variables to the shared Variables store
  max_run_seconds INT NOT NULL DEFAULT 1800,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_workflow_step (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  workflow_id BIGINT NOT NULL,
  step_order INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  request_id BIGINT NOT NULL,
  on_failure VARCHAR(10) NOT NULL DEFAULT 'STOP',  -- STOP | CONTINUE
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  options_json TEXT,
  FOREIGN KEY (workflow_id) REFERENCES api_workflow(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES api_request(id)
);

CREATE TABLE IF NOT EXISTS api_workflow_run (
  run_id VARCHAR(40) PRIMARY KEY,
  workflow_id BIGINT,
  workflow_name VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL,                    -- QUEUED RUNNING SUCCESS FAILED CANCELLED TIMED_OUT
  triggered_by VARCHAR(100),
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  duration_ms BIGINT,
  total_steps INT,
  passed_steps INT,
  failed_steps INT,
  error VARCHAR(2000),
  inputs_masked VARCHAR(2000)
);

CREATE TABLE IF NOT EXISTS api_workflow_step_run (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id VARCHAR(40) NOT NULL,
  step_order INT NOT NULL,
  step_name VARCHAR(200),
  request_name VARCHAR(200),
  method VARCHAR(10),
  url_display VARCHAR(2000),
  status VARCHAR(20) NOT NULL,
  attempts INT,
  http_status INT,
  duration_ms BIGINT,
  started_at TIMESTAMP,
  finished_at TIMESTAMP,
  error VARCHAR(2000),
  response_snippet TEXT,                           -- failed steps only
  extracted_json TEXT                              -- secret values masked
);

-- ---------------------------------------------------------------- folders (shared by requests, API workflows, variables, information)
CREATE TABLE IF NOT EXISTS folder (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  kind VARCHAR(20) NOT NULL,                      -- REQUEST | API_WORKFLOW | VARIABLE | INFO
  parent_id BIGINT NOT NULL DEFAULT 0,            -- 0 = top level
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (kind, parent_id, name)
);

ALTER TABLE api_request ADD COLUMN IF NOT EXISTS folder_id BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE api_workflow ADD COLUMN IF NOT EXISTS folder_id BIGINT DEFAULT 0 NOT NULL;

-- API workflow steps can also run a saved SQL query.
ALTER TABLE api_workflow_step ALTER COLUMN request_id SET NULL;
ALTER TABLE api_workflow_step ADD COLUMN IF NOT EXISTS step_type VARCHAR(20) DEFAULT 'API_REQUEST' NOT NULL;
ALTER TABLE api_workflow_step ADD COLUMN IF NOT EXISTS query_id BIGINT;
ALTER TABLE api_workflow_step ADD COLUMN IF NOT EXISTS param_values_json TEXT;

-- Saved queries can save values from their first result row into variables.
ALTER TABLE saved_query ADD COLUMN IF NOT EXISTS extractions_json TEXT;
-- Queries Manager folders (folder.kind = 'QUERY'); 0 = Unfiled.
ALTER TABLE saved_query ADD COLUMN IF NOT EXISTS folder_id BIGINT DEFAULT 0 NOT NULL;

-- ---------------------------------------------------------------- All-in-One Information
CREATE TABLE IF NOT EXISTS info_item (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  folder_id BIGINT NOT NULL DEFAULT 0,
  title VARCHAR(200) NOT NULL,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Workflow Manager: folders for main / micro business flows, and nested workflows (a step that runs another workflow).
ALTER TABLE workflow ADD COLUMN IF NOT EXISTS folder_id BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE workflow_step ADD COLUMN IF NOT EXISTS sub_workflow_id BIGINT;

-- ---------------------------------------------------------------- multi-database connections (MySQL + MongoDB)
-- A connection has its own ACCESS password (stored only as a salted PBKDF2 hash) that must be entered to use, test, edit or delete it.
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS db_type VARCHAR(10) DEFAULT 'MYSQL' NOT NULL;
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS owner_name VARCHAR(100);
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS access_password_hash VARCHAR(300);
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS uri_encrypted VARCHAR(4096);   -- MongoDB connection string, envelope-encrypted (may embed credentials)
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS auth_database VARCHAR(128);
ALTER TABLE connection_profile ADD COLUMN IF NOT EXISTS tls BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE connection_profile ALTER COLUMN password_encrypted SET NULL;
ALTER TABLE connection_profile ALTER COLUMN username SET NULL;

-- Saved queries can target MongoDB: sql_text then holds a JSON query spec.
ALTER TABLE saved_query ADD COLUMN IF NOT EXISTS engine VARCHAR(10) DEFAULT 'MYSQL' NOT NULL;

-- The database is chosen after connecting (discovered from the server), so a connection no longer needs one.
ALTER TABLE connection_profile ALTER COLUMN database_name SET NULL;

-- UAT is now called Staging (idempotent: safe to run on every start). Credentials and settings are untouched.
UPDATE connection_profile SET environment = 'STAGING' WHERE environment = 'UAT';
UPDATE saved_query SET environments = REPLACE(environments, 'UAT', 'STAGING') WHERE environments LIKE '%UAT%';
UPDATE api_variable SET environment = 'STAGING', scope_key = 'ESTAGING' WHERE environment = 'UAT';
UPDATE app_setting SET setting_value = 'STAGING' WHERE setting_key = 'automation.activeEnvironment' AND setting_value = 'UAT';
UPDATE execution_history SET environment = 'STAGING' WHERE environment = 'UAT';
UPDATE workflow_run SET environment = 'STAGING' WHERE environment = 'UAT';
UPDATE audit_log SET environment = 'STAGING' WHERE environment = 'UAT';

-- ---------------------------------------------------------------- Projects -> Folders -> Workflows
-- Workflow Manager hierarchy. Every workflow belongs to a project; workflow folders belong to a project; a workflow may sit in a folder
-- (folder_id 0 = directly in the project). Existing workflows and folders are moved into a "Default Project" at startup
-- (see ProjectMigration), keeping every id, configuration and run history.
CREATE TABLE IF NOT EXISTS project (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  description VARCHAR(1000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE folder ADD COLUMN IF NOT EXISTS project_id BIGINT DEFAULT 0 NOT NULL;
ALTER TABLE workflow ADD COLUMN IF NOT EXISTS project_id BIGINT DEFAULT 0 NOT NULL;

-- Workflow inputs can have an optional default value (used when nothing is provided at run time).
ALTER TABLE workflow_input ADD COLUMN IF NOT EXISTS default_value VARCHAR(500);

-- One-time seeds that have run (so deleted sample data is not recreated at the next start).
CREATE TABLE IF NOT EXISTS seed_marker (name VARCHAR(100) PRIMARY KEY);
