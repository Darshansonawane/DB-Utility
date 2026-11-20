import type { Folder, Project, Workflow } from '../../types';

/** Drag payloads: a workflow id and a folder id travel under different keys so a drop target can tell them apart. */
export { DRAG_TYPE as WORKFLOW_DRAG } from '../folders/FolderExplorer';
export const FOLDER_DRAG = 'application/x-dbutility-folder';

export type RunKind = 'success' | 'failed' | 'other' | 'never';
export type StatusFilter = 'ALL' | 'SUCCESS' | 'FAILED' | 'NEVER';
export type Recency = 'ANY' | '1d' | '7d' | '30d';

export interface Filters { query: string; status: StatusFilter; updated: Recency; executed: Recency }
export const NO_FILTERS: Filters = { query: '', status: 'ALL', updated: 'ANY', executed: 'ANY' };

export interface Data { projects: Project[]; folders: Folder[]; workflows: Workflow[] }

export function runKind(w: Workflow): RunKind {
  if (!w.lastStatus) return 'never';
  if (w.lastStatus === 'SUCCESS') return 'success';
  if (w.lastStatus === 'FAILED') return 'failed';
  return 'other';
}

const DAY = 86_400_000;
const WINDOW: Record<Recency, number> = { ANY: Infinity, '1d': DAY, '7d': 7 * DAY, '30d': 30 * DAY };

function within(iso: string | null | undefined, r: Recency, now: number): boolean {
  if (r === 'ANY') return true;
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && now - t <= WINDOW[r];
}

/** Any workflow-level filter besides the free-text search. */
export function hasWorkflowFilters(f: Filters): boolean {
  return f.status !== 'ALL' || f.updated !== 'ANY' || f.executed !== 'ANY';
}

export function isFiltering(f: Filters): boolean {
  return f.query.trim() !== '' || hasWorkflowFilters(f);
}

export function matchesWorkflowFilters(w: Workflow, f: Filters, now: number): boolean {
  if (f.status === 'SUCCESS' && runKind(w) !== 'success') return false;
  if (f.status === 'FAILED' && runKind(w) !== 'failed') return false;
  if (f.status === 'NEVER' && runKind(w) !== 'never') return false;
  return within(w.updatedAt, f.updated, now) && within(w.lastRunAt, f.executed, now);
}

/** "Savings Wallet › E2E Automation › Regression" for a folder (or just the project when folderId is 0). */
export function pathLabel(data: Data, projectId: number, folderId: number): string {
  const project = data.projects.find((p) => p.id === projectId)?.name ?? '';
  const byId = new Map(data.folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  for (let id = folderId, guard = 0; id !== 0 && byId.has(id) && guard++ < 20; id = byId.get(id)!.parentId) parts.unshift(byId.get(id)!.name);
  return [project, ...parts].join(' › ');
}

/** Folder and everything below it. */
export function subtree(folders: Folder[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** Workflows inside a folder including all its subfolders. */
export function workflowsUnder(data: Data, folderId: number): Workflow[] {
  const ids = subtree(data.folders, folderId);
  return data.workflows.filter((w) => ids.has(w.folderId ?? 0));
}

export const childFolders = (data: Data, projectId: number, parentId: number): Folder[] =>
  data.folders.filter((f) => f.projectId === projectId && f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export const workflowsIn = (data: Data, projectId: number, folderId: number): Workflow[] =>
  data.workflows.filter((w) => (w.projectId ?? 0) === projectId && (w.folderId ?? 0) === folderId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

export interface Results { projects: Project[]; folders: Folder[]; workflows: Workflow[] }

/**
 * One search across the whole hierarchy: project names (and descriptions), folder names, workflow names and descriptions. Every word of the
 * query must match. The status / updated / executed filters apply to workflows; `scopeProject` (0 = all) limits everything to one project.
 * Pure and synchronous, so typing never waits for the server.
 */
export function search(data: Data, f: Filters, scopeProject: number, now: number = Date.now()): Results {
  const tokens = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...texts: (string | null | undefined)[]) => {
    if (tokens.length === 0) return true;
    const h = texts.filter(Boolean).join(' ').toLowerCase();
    return tokens.every((t) => h.includes(t));
  };
  const inScope = (projectId: number | null | undefined) => scopeProject === 0 || projectId === scopeProject;
  const workflowOnly = hasWorkflowFilters(f);
  const projects = tokens.length > 0 && !workflowOnly ? data.projects.filter((p) => inScope(p.id) && matches(p.name, p.description)) : [];
  const folders = tokens.length > 0 && !workflowOnly ? data.folders.filter((x) => inScope(x.projectId) && matches(x.name)) : [];
  const workflows = data.workflows.filter((w) => inScope(w.projectId) && matches(w.name, w.description) && matchesWorkflowFilters(w, f, now))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { projects, folders, workflows };
}
