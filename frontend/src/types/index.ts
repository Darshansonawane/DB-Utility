export type ParamType = 'STRING' | 'INTEGER' | 'DECIMAL' | 'DATE' | 'DATETIME' | 'BOOLEAN';
export type QueryType = 'READ' | 'WRITE';

export interface QueryParameter {
  name: string;
  label: string;
  type: ParamType;
  required: boolean;
  defaultValue?: string | null;
}

export interface QueryExtraction { variable: string; column: string; secret: boolean; folderId?: number | null }

export interface SavedQuery {
  id?: number;
  name: string;
  description?: string;
  category?: string;
  sql: string;
  queryType?: QueryType;
  environments: string[];
  enabled: boolean;
  databaseName?: string | null;
  parameters: QueryParameter[];
  extractions?: QueryExtraction[];
  /** MYSQL (default): sql is a SQL statement. MONGODB: sql is a JSON query spec; "?" strings are the parameters. */
  engine?: DbType;
}

export interface Column { name: string; type: string }
export interface QueryResult {
  extracted?: ApiExtracted[];
  columns: Column[];
  rows: unknown[][];
  truncated: boolean;
  rowCount: number;
  affectedRows?: number | null;
  durationMs: number;
  statementType: string;
}
export interface Assignment { column: string; expression: string; newValue?: string | null }
export interface WritePreview {
  statementType: string;
  sql: string;
  params: string[];
  affectedRows?: number | null;
  columns: Column[];
  targetRows: unknown[][];
  proposedChanges: Assignment[];
  previewDerived: boolean;
  maxAffectedRows: number;
  withinLimit: boolean;
  executable: boolean;
  blockedReason?: string | null;
  confirmationToken?: string | null;
  warnings: string[];
}
export interface SqlAnalysis { statementType: string; write: boolean; placeholders: number; suggestedParameters: QueryParameter[] }
export interface ParamValue { type: ParamType; value: string }

export type DbType = 'MYSQL' | 'MONGODB';
export interface ConnectionView {
  id: number; name: string; environment: string; dbType: DbType; host: string; port: number; databaseName?: string | null;
  username?: string | null; authDatabase?: string | null; tls: boolean; usesUri: boolean; ownerName?: string | null;
  /** false for connections created before access passwords existed: one must be chosen before use */
  passwordProtected: boolean; connected: boolean; active: boolean;
}
/** Every secret is write-only: sent to the backend, never returned. */
export interface ConnectionRequest {
  name: string; environment: string; dbType: DbType; host: string; port: number; databaseName?: string; username: string; password?: string;
  useUri: boolean; uri?: string; authDatabase?: string; tls: boolean; ownerName?: string;
  /** on create: the password people must enter to use the connection; on edit: its CURRENT access password */
  accessPassword?: string; newAccessPassword?: string;
}
export interface TestResult { success: boolean; latencyMs: number; serverVersion?: string; message: string }
export interface StatusView {
  connected: boolean; profileId?: number; connectionName?: string; environment?: string;
  host?: string; databaseName?: string; latencyMs?: number; message: string; dbType?: DbType; active?: boolean;
}
/** restricted: the server would not list databases for this user, so the list may be incomplete and a name can be typed. */
export interface DatabaseList { databases: string[]; selected?: string | null; restricted: boolean; message?: string | null }
export interface AppSettings {
  readOnlyMode: boolean; maxResultRows: number; queryTimeoutSeconds: number; maxAffectedRows: number;
  adHocWritesEnabled: boolean; maskSensitiveData: boolean;
}

export type SourceType = 'INPUT' | 'STEP_OUTPUT' | 'CONSTANT';
/** defaultValue is optional: used when nothing is provided at run time */
export interface WorkflowInput { name: string; label: string; type: ParamType; required: boolean; defaultValue?: string | null }
export interface ParamMapping { paramName: string; sourceType: SourceType; sourceRef?: string; sourceField?: string; constantValue?: string }
export interface OutputField { alias: string; column: string }
export interface WorkflowStep {
  id?: number; order: number; name: string; description?: string; queryId: number; queryName?: string;
  dependsOn: number[]; retryCount: number; retryDelayMs: number; stopOnFailure: boolean;
  outputFields: OutputField[]; mappings: ParamMapping[];
  stepType?: 'QUERY' | 'API_REQUEST' | 'WORKFLOW'; apiRequestId?: number | null; apiRequestName?: string; apiOptions?: ApiStepOptions | null;
  subWorkflowId?: number | null; subWorkflowName?: string;
}
export interface Workflow {
  id?: number; name: string; description?: string; inputs: WorkflowInput[]; steps: WorkflowStep[]; folderId?: number | null;
  /** owning project (optional when saving: a folder's project, else the default project) */
  projectId?: number | null;
  /** read-only: last change, and the most recent run (null/undefined lastStatus = never run) */
  updatedAt?: string | null; lastStatus?: string | null; lastRunAt?: string | null;
}
export interface Project { id: number; name: string; description?: string | null; folderCount: number; workflowCount: number; createdAt?: string; updatedAt?: string }

export type StepStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'NO_DATA' | 'FAILED' | 'BLOCKED' | 'STOPPED' | 'SKIPPED';
export interface StepRunView {
  order: number; name: string; description?: string; queryName?: string; status: StepStatus; durationMs?: number;
  attempts: number; params: Record<string, string>; paramSources: Record<string, string>;
  result?: QueryResult | null; outputs: Record<string, unknown>; message?: string; error?: string; children?: StepRunView[];
}
export interface RunView {
  runId: string; workflowId: number; workflowName: string; status: string; startedAt: string; finishedAt?: string;
  durationMs?: number; inputs: Record<string, string>; steps: StepRunView[];
}

export interface Dashboard {
  connection: StatusView; savedQueries: number; workflows: number; successfulExecutions: number;
  failedExecutions: number; recentExecutions: Record<string, unknown>[];
}

export interface ApiHeader { name: string; value: string }
export interface ApiExtraction { variable: string; source: 'BODY' | 'BODY_REGEX' | 'HEADER' | 'STATUS'; path?: string; secret: boolean; folderId?: number | null }
export interface ApiRequestDef {
  id?: number; name: string; description?: string; method: string; url: string;
  headers: ApiHeader[]; body?: string; extractions: ApiExtraction[]; expectedStatus?: number | null; preScript?: string | null; folderId?: number | null;
}
export interface ApiExtracted { variable: string; value?: string; secret: boolean; found: boolean }
export interface ApiRunResult {
  name: string; success: boolean; status?: number; durationMs: number; resolvedUrl?: string;
  headers: Record<string, string[]>; body?: string; bodyTruncated: boolean; extracted: ApiExtracted[]; error?: string;
  scriptLog?: string[]; sent?: { method: string; url: string; headers: Record<string, string>; body?: string | null } | null;
}
export interface VariableView {
  id: number; name: string; value: string; secret: boolean; source?: string; sourceType: 'API' | 'SQL' | 'SCRIPT' | 'MANUAL'; sourceName?: string;
  scope: 'GLOBAL' | 'FOLDER' | 'ENVIRONMENT'; folderId: number; folderPath: string; environment: string; updatedAt?: string;
}

export interface ApiCondition { source: 'STATUS' | 'HEADER' | 'BODY'; path?: string; operator: string; value?: string }
export interface ApiStepOptions {
  waitBeforeSeconds: number; pollIntervalSeconds: number; pollTimeoutSeconds: number; maxAttempts: number;
  until: ApiCondition[]; assertions: ApiCondition[];
}
export interface ApiWfStep {
  id?: number; order: number; name: string; requestId: number; requestName?: string; requestMethod?: string;
  onFailure: 'STOP' | 'CONTINUE'; enabled: boolean; options: ApiStepOptions;
  stepType?: 'API_REQUEST' | 'SQL_QUERY'; queryId?: number | null; queryName?: string; paramValues?: Record<string, string>;
}
export interface ApiWorkflowDef { id?: number; name: string; description?: string; publishGlobal: boolean; maxRunSeconds: number; steps: ApiWfStep[]; folderId?: number | null }
export type RunStatus = 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
export interface ApiStepRunView {
  order: number; name: string; requestName?: string; method?: string; url?: string; status: string; attempts: number; maxAttempts: number;
  httpStatus?: number | null; durationMs?: number | null; startedAt?: string; finishedAt?: string; liveStatus?: string | null;
  error?: string | null; extracted: ApiExtracted[]; responseSnippet?: string | null;
}
export interface ApiRunView {
  runId: string; workflowId?: number; workflowName: string; status: RunStatus; triggeredBy?: string; startedAt?: string; finishedAt?: string;
  durationMs?: number; inputs: Record<string, string>; error?: string | null; steps: ApiStepRunView[];
}
export interface RunSummary {
  runId: string; workflowId?: number; workflowName: string; status: RunStatus; triggeredBy?: string; startedAt?: string; finishedAt?: string;
  durationMs?: number; totalSteps: number; passedSteps: number; failedSteps: number; error?: string | null;
}
export interface StepStat { order: number; name: string; runs: number; failures: number; avgMs: number; maxMs: number; avgAttempts: number }
export interface DayStat { day: string; runs: number; passed: number; failed: number }
export interface WorkflowReport {
  workflowId: number; workflowName: string; days: number; totalRuns: number; passed: number; failed: number; cancelled: number; timedOut: number;
  passRate: number; avgMs: number; minMs: number; maxMs: number; p95Ms: number; lastStatus?: string; lastRunAt?: string;
  steps: StepStat[]; trend: DayStat[]; recent: RunSummary[];
}
export interface OverviewRow { workflowId: number; workflowName: string; steps: number; runs: number; passRate: number; avgMs: number; lastStatus?: string; lastRunAt?: string }

export type FolderKind = 'REQUEST' | 'API_WORKFLOW' | 'VARIABLE' | 'INFO' | 'WORKFLOW';
export interface Folder { id: number; kind: FolderKind; parentId: number; name: string; projectId?: number }
export interface VariableBody { name?: string; value?: string | null; secret: boolean; scope: string; folderId?: number | null; environment?: string }
export interface TokenInfo { token: string; name: string; found: boolean; value?: string | null; origin: string; secret: boolean }
export interface PreviewResult { method: string; url: string; headers: Record<string, string>; body?: string | null; tokens: TokenInfo[]; ready: boolean }
export interface ParamPreview { name: string; label: string; type: string; expression: string; resolved: string; status: 'OK' | 'MISSING' | 'EMPTY' | 'MISSING_VARIABLE' | 'INVALID'; message?: string | null; tokens: TokenInfo[] }
export interface InfoItem { id?: number; folderId: number; title: string; content: string; createdAt?: string; updatedAt?: string }
export interface InfoSummary { id: number; folderId: number; title: string; snippet: string; updatedAt?: string }

/** What the Run dialog shows before anything runs: inputs with defaults, and each step's parameters with where their value comes from. */
export interface RunFormParam {
  name: string; label: string; type: ParamType; required: boolean; defaultValue?: string | null;
  sourceKind: 'AUTOMATIC' | 'WORKFLOW_INPUT' | 'CONSTANT' | 'DEFAULT' | 'NONE'; source: string; constant?: string | null; inputRef?: string | null;
}
export interface RunFormStep { order: number; name: string; stepType: string; params: RunFormParam[] }
export interface RunForm { inputs: { name: string; label: string; type: ParamType; required: boolean; defaultValue?: string | null }[]; steps: RunFormStep[] }
