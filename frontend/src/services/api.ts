import axios from 'axios';
import type {
  AppSettings, DbType, Project, RunForm, ConnectionRequest, ConnectionView, Dashboard, ParamValue, QueryResult, RunView, SavedQuery,
  SqlAnalysis, StatusView, ApiRequestDef, ApiRunResult, ApiWorkflowDef, ApiRunView, Folder, FolderKind, VariableBody, PreviewResult, ParamPreview, InfoItem, InfoSummary, RunSummary, WorkflowReport, OverviewRow, VariableView, DatabaseList, TestResult, Workflow, WritePreview, CellEditPreview,
} from '../types';

// The browser only talks to the backend. Credentials never leave the server.
export const http = axios.create({ baseURL: '/api', headers: { 'X-QA-Utility': 'ui' }, timeout: 180_000 });

export function errMsg(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const data = e.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (!e.response) return 'Cannot reach the backend on http://127.0.0.1:8080. Is it running?';
    return `Request failed (${e.response.status})`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** HTTP status of a failed request, if there was a response. */
export function errStatus(e: unknown): number | undefined {
  return axios.isAxiosError(e) ? e.response?.status : undefined;
}

const d = <T,>(p: Promise<{ data: T }>) => p.then((r) => r.data);

export const api = {
  dashboard: () => d<Dashboard>(http.get('/dashboard')),

  connections: () => d<ConnectionView[]>(http.get('/connections')),
  createConnection: (r: ConnectionRequest) => d<ConnectionView>(http.post('/connections', r)),
  updateConnection: (id: number, r: ConnectionRequest) => d<ConnectionView>(http.put(`/connections/${id}`, r)),
  deleteConnection: (id: number, accessPassword: string) => d<void>(http.delete(`/connections/${id}`, { data: { accessPassword } })),
  testConnectionDraft: (r: ConnectionRequest) => d<TestResult>(http.post('/connections/test', r)),
  testConnection: (id: number, accessPassword: string) => d<TestResult>(http.post(`/connections/${id}/test`, { accessPassword })),
  connect: (id: number, accessPassword: string) => d<StatusView>(http.post(`/connections/${id}/connect`, { accessPassword })),
  disconnectOne: (id: number) => d<StatusView>(http.post(`/connections/${id}/disconnect`)),
  disconnect: () => d<StatusView>(http.post('/connections/disconnect')),
  activateConnection: (id: number) => d<StatusView>(http.post(`/connections/${id}/activate`)),
  setAccessPassword: (id: number, newAccessPassword: string) => d<ConnectionView>(http.post(`/connections/${id}/access-password`, { newAccessPassword })),
  statuses: () => d<StatusView[]>(http.get('/connections/statuses')),
  mongoAnalyze: (query: string) => d<SqlAnalysis>(http.post('/mongo/analyze', { query })),
  mongoCollections: () => d<string[]>(http.get('/mongo/collections')),
  status: () => d<StatusView>(http.get('/connections/status')),
  apiRequests: () => d<ApiRequestDef[]>(http.get('/automation/requests')),
  saveApiRequest: (r: ApiRequestDef) => d<ApiRequestDef>(r.id ? http.put(`/automation/requests/${r.id}`, r) : http.post('/automation/requests', r)),
  deleteApiRequest: (id: number) => d<void>(http.delete(`/automation/requests/${id}`)),
  runApiRequest: (r: ApiRequestDef) => d<ApiRunResult>(http.post('/automation/run', r)),
  apiWorkflows: () => d<ApiWorkflowDef[]>(http.get('/automation/workflows')),
  saveApiWorkflow: (w: ApiWorkflowDef) => d<ApiWorkflowDef>(w.id ? http.put(`/automation/workflows/${w.id}`, w) : http.post('/automation/workflows', w)),
  deleteApiWorkflow: (id: number) => d<void>(http.delete(`/automation/workflows/${id}`)),
  runApiWorkflow: (id: number, inputs?: Record<string, string>) => d<{ runId: string }>(http.post(`/automation/workflows/${id}/run`, { inputs: inputs ?? {} })),
  runApiWorkflows: (workflowIds: number[], inputs?: Record<string, string>) => d<{ runIds: string[] }>(http.post('/automation/workflows/run-batch', { workflowIds, inputs: inputs ?? {} })),
  apiRuns: (workflowId?: number, limit = 50) => d<RunSummary[]>(http.get('/automation/runs', { params: { workflowId, limit } })),
  activeApiRuns: () => d<{ maxConcurrent: number; runs: RunSummary[] }>(http.get('/automation/runs/active')),
  apiRun: (runId: string) => d<ApiRunView>(http.get(`/automation/runs/${runId}`)),
  cancelApiRun: (runId: string) => d<ApiRunView>(http.post(`/automation/runs/${runId}/cancel`)),
  apiReport: (id: number, days: number) => d<WorkflowReport>(http.get(`/automation/workflows/${id}/report`, { params: { days } })),
  apiReportOverview: () => d<OverviewRow[]>(http.get('/automation/reports/overview')),
  apiReportCsv: (id: number, days: number) => d<string>(http.get(`/automation/workflows/${id}/report.csv`, { params: { days }, responseType: 'text' })),
  variables: () => d<VariableView[]>(http.get('/automation/variables')),
  saveVariable: (id: number | undefined, b: VariableBody) => d<VariableView>(id ? http.put(`/automation/variables/${id}`, b) : http.post('/automation/variables', b)),
  saveVariablesBulk: (source: string, items: { name: string; value: string; secret: boolean; folderId?: number | null }[]) => d<{ saved: number }>(http.post('/automation/variables/bulk', { source, items })),
  moveVariable: (id: number, folderId: number) => d<void>(http.put(`/automation/variables/${id}/folder`, { folderId })),
  deleteVariable: (id: number) => d<void>(http.delete(`/automation/variables/${id}`)),
  clearVariables: () => d<void>(http.delete('/automation/variables')),
  activeEnvironment: () => d<{ environment: string }>(http.get('/automation/environment')),
  setActiveEnvironment: (environment: string) => d<{ environment: string }>(http.put('/automation/environment', { environment })),
  folders: (kind: FolderKind) => d<Folder[]>(http.get('/folders', { params: { kind } })),
  createFolder: (kind: FolderKind, parentId: number, name: string, projectId?: number) => d<Folder>(http.post('/folders', { kind, parentId, name, projectId })),
  projects: () => d<Project[]>(http.get('/projects')),
  createProject: (name: string, description?: string) => d<Project>(http.post('/projects', { name, description })),
  updateProject: (id: number, name: string, description?: string) => d<Project>(http.put(`/projects/${id}`, { name, description })),
  deleteProject: (id: number, moveTo?: number) => d<void>(http.delete(`/projects/${id}`, { params: { moveTo } })),
  updateFolder: (id: number, patch: { name?: string; parentId?: number }) => d<Folder>(http.put(`/folders/${id}`, patch)),
  deleteFolder: (id: number) => d<void>(http.delete(`/folders/${id}`)),
  queryFolders: () => d<Record<string, number>>(http.get('/queries/folders')),
  moveQuery: (id: number, folderId: number) => d<void>(http.put(`/queries/${id}/folder`, { folderId })),
  moveWorkflow: (id: number, folderId: number, projectId?: number) => d<void>(http.put(`/workflows/${id}/folder`, { folderId, projectId })),
  moveApiRequest: (id: number, folderId: number) => d<void>(http.put(`/automation/requests/${id}/folder`, { folderId })),
  moveApiWorkflow: (id: number, folderId: number) => d<void>(http.put(`/automation/workflows/${id}/folder`, { folderId })),
  previewApiRequest: (r: ApiRequestDef) => d<PreviewResult>(http.post('/automation/preview', r)),
  clearApiRuns: (workflowId?: number) => d<{ deleted: number }>(http.delete('/automation/runs', { params: { workflowId } })),
  deleteApiRuns: (runIds: string[]) => d<{ deleted: number }>(http.post('/automation/runs/delete', { runIds })),
  resolveQuery: (id: number, values: Record<string, string>) => d<ParamPreview[]>(http.post(`/queries/${id}/resolve`, { values })),
  infoItems: (q?: string) => d<InfoSummary[]>(http.get('/info/items', { params: { q } })),
  infoItem: (id: number) => d<InfoItem>(http.get(`/info/items/${id}`)),
  saveInfoItem: (i: InfoItem) => d<InfoItem>(i.id ? http.put(`/info/items/${i.id}`, i) : http.post('/info/items', i)),
  moveInfoItem: (id: number, folderId: number) => d<void>(http.put(`/info/items/${id}/folder`, { folderId })),
  deleteInfoItem: (id: number) => d<void>(http.delete(`/info/items/${id}`)),
  databases: (dbType: DbType = 'MYSQL') => d<DatabaseList>(http.get('/connections/databases', { params: { dbType } })),
  useDatabase: (name: string, dbType: DbType = 'MYSQL') => d<StatusView>(http.post('/connections/database', { name, dbType })),

  openVpn: () => d<{ opened: boolean; app: string }>(http.post('/vpn/open')),
  reachable: (id: number) => d<{ reachable: boolean; ms?: number; message?: string }>(http.get(`/vpn/reachable/${id}`)),

  analyzeSql: (sql: string) => d<SqlAnalysis>(http.post('/sql/analyze', { sql })),
  executeSql: (sql: string, params: ParamValue[], confirmationToken?: string) =>
    d<QueryResult>(http.post('/sql/execute', { sql, params, confirmationToken })),
  previewSql: (sql: string, params: ParamValue[]) => d<WritePreview>(http.post('/sql/preview', { sql, params })),

  queries: (q?: string, category?: string) => d<SavedQuery[]>(http.get('/queries', { params: { q, category } })),
  categories: () => d<string[]>(http.get('/queries/categories')),
  createQuery: (q: SavedQuery) => d<SavedQuery>(http.post('/queries', q)),
  updateQuery: (id: number, q: SavedQuery) => d<SavedQuery>(http.put(`/queries/${id}`, q)),
  deleteQuery: (id: number) => d<void>(http.delete(`/queries/${id}`)),
  duplicateQuery: (id: number) => d<SavedQuery>(http.post(`/queries/${id}/duplicate`)),
  setQueryEnabled: (id: number, value: boolean) => d<SavedQuery>(http.post(`/queries/${id}/enabled`, null, { params: { value } })),
  testRunQuery: (query: SavedQuery, values: Record<string, string>) => d<QueryResult>(http.post('/queries/test-run', { query, values })),
  executeQuery: (id: number, values: Record<string, string>, confirmationToken?: string) =>
    d<QueryResult>(http.post(`/queries/${id}/execute`, { values, confirmationToken })),
  previewQuery: (id: number, values: Record<string, string>) => d<WritePreview>(http.post(`/queries/${id}/preview`, { values })),

  schemas: () => d<string[]>(http.get('/metadata/schemas')),
  tables: (schema: string) => d<Record<string, unknown>[]>(http.get(`/metadata/schemas/${schema}/tables`)),
  table: (schema: string, table: string) =>
    d<{ columns: Record<string, string>[]; primaryKey: string[]; foreignKeys: Record<string, string>[] }>(
      http.get(`/metadata/schemas/${schema}/tables/${table}`)),
  distinctValues: (schema: string, table: string, column: string) =>
    d<Record<string, unknown>[]>(http.get(`/metadata/schemas/${schema}/tables/${table}/columns/${column}/values`)),
  sample: (schema: string, table: string) =>
    d<Record<string, unknown>[]>(http.get(`/metadata/schemas/${schema}/tables/${table}/sample`, { params: { limit: 10 } })),

  workflows: () => d<Workflow[]>(http.get('/workflows')),
  createWorkflow: (w: Workflow) => d<Workflow>(http.post('/workflows', w)),
  updateWorkflow: (id: number, w: Workflow) => d<Workflow>(http.put(`/workflows/${id}`, w)),
  deleteWorkflow: (id: number) => d<void>(http.delete(`/workflows/${id}`)),
  startRun: (id: number, inputs: Record<string, string>, overrides: Record<number, Record<string, string>>, steps: number[]) =>
    d<RunView>(http.post(`/workflows/${id}/runs`, { inputs, overrides, steps })),
  previewCellEdit: (runId: string, order: number, b: { rowIndex: number; column: string; value: string }) =>
    d<CellEditPreview>(http.post(`/workflow-runs/${runId}/steps/${order}/edit-preview`, b)),
  applyCellEdit: (runId: string, order: number, b: { rowIndex: number; column: string; value: string; confirmationToken?: string | null }) =>
    d<{ column: string; newValue?: string | null; affectedRows?: number | null }>(http.post(`/workflow-runs/${runId}/steps/${order}/edit-apply`, b)),
  getRun: (runId: string) => d<RunView>(http.get(`/workflow-runs/${runId}`)),
  executeOnRun: (runId: string, steps: number[], overrides: Record<number, Record<string, string>>) =>
    d<RunView>(http.post(`/workflow-runs/${runId}/execute`, { steps, overrides })),
  stopRun: (runId: string) => d<RunView>(http.post(`/workflow-runs/${runId}/stop`)),
  workflowRunForm: (id: number) => d<RunForm>(http.get(`/workflows/${id}/run-form`)),
  saveInputDefaults: (id: number, defaults: Record<string, string>) => d<void>(http.put(`/workflows/${id}/input-defaults`, { defaults })),

  executions: (status?: string) => d<Record<string, unknown>[]>(http.get('/history/executions', { params: { status, limit: 200 } })),
  workflowRuns: (customerId?: string) => d<Record<string, unknown>[]>(http.get('/history/workflow-runs', { params: { customerId, limit: 200 } })),
  workflowRun: (id: string) => d<Record<string, unknown>>(http.get(`/history/workflow-runs/${id}`)),
  audit: () => d<Record<string, unknown>[]>(http.get('/history/audit', { params: { limit: 200 } })),

  settings: () => d<AppSettings>(http.get('/settings')),
  saveSettings: (s: AppSettings) => d<AppSettings>(http.put('/settings', s)),
};
