import { describe, expect, it } from 'vitest';
import type { Folder, Project, Workflow } from '../types';
import { NO_FILTERS, childFolders, isFiltering, matchesWorkflowFilters, pathLabel, runKind, search, subtree, workflowsIn, workflowsUnder, type Data } from '../components/projects/workflowHierarchy';
import { timeAgo } from '../utils/time';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000, D = 24 * H;

const projects: Project[] = [
  { id: 1, name: 'Savings Wallet', description: 'Wallet and goals', folderCount: 3, workflowCount: 4 },
  { id: 2, name: 'HelloBank', description: 'Retail app', folderCount: 0, workflowCount: 1 },
];
const folders: Folder[] = [
  { id: 10, kind: 'WORKFLOW', parentId: 0, name: 'E2E Automation', projectId: 1 },
  { id: 11, kind: 'WORKFLOW', parentId: 10, name: 'Regression', projectId: 1 },
  { id: 12, kind: 'WORKFLOW', parentId: 0, name: 'Micro flows', projectId: 1 },
];
const wf = (o: Partial<Workflow> & { id: number; name: string }): Workflow => ({ inputs: [], steps: [], folderId: 0, projectId: 1, ...o });
const workflows: Workflow[] = [
  wf({ id: 1, name: 'Create wallet', description: 'Creates a savings wallet through the API', folderId: 10, lastStatus: 'SUCCESS', lastRunAt: ago(2 * H), updatedAt: ago(5 * D) }),
  wf({ id: 2, name: 'Goal reached', folderId: 11, lastStatus: 'FAILED', lastRunAt: ago(3 * D), updatedAt: ago(1 * H) }),
  wf({ id: 3, name: 'Top level flow', folderId: 0, updatedAt: ago(40 * D) }),
  wf({ id: 4, name: 'Token helper', folderId: 12, lastStatus: 'PARTIAL', lastRunAt: ago(10 * D), updatedAt: ago(20 * D) }),
  wf({ id: 5, name: 'Login', projectId: 2, folderId: 0, lastStatus: 'SUCCESS', lastRunAt: ago(1 * H), updatedAt: ago(2 * H) }),
];
const data: Data = { projects, folders, workflows };
const names = (l: { name: string }[]) => l.map((x) => x.name);

describe('structure helpers', () => {
  it('knows what is directly in a place and what is below it', () => {
    expect(names(childFolders(data, 1, 0))).toEqual(['E2E Automation', 'Micro flows']);
    expect(names(childFolders(data, 1, 10))).toEqual(['Regression']);
    expect(names(workflowsIn(data, 1, 0))).toEqual(['Top level flow']);
    expect(names(workflowsIn(data, 1, 10))).toEqual(['Create wallet']);
    expect([...subtree(folders, 10)].sort()).toEqual([10, 11]);
    expect(names(workflowsUnder(data, 10)).sort()).toEqual(['Create wallet', 'Goal reached']);
  });
  it('builds the breadcrumb style path', () => {
    expect(pathLabel(data, 1, 11)).toBe('Savings Wallet › E2E Automation › Regression');
    expect(pathLabel(data, 2, 0)).toBe('HelloBank');
  });
  it('classifies the last execution', () => {
    expect(workflows.map(runKind)).toEqual(['success', 'failed', 'never', 'other', 'success']);
  });
});

describe('global search', () => {
  it('finds projects, folders, workflow names and descriptions', () => {
    expect(names(search(data, { ...NO_FILTERS, query: 'wallet' }, 0, NOW).projects)).toEqual(['Savings Wallet']);
    expect(names(search(data, { ...NO_FILTERS, query: 'wallet' }, 0, NOW).workflows)).toEqual(['Create wallet']);
    expect(names(search(data, { ...NO_FILTERS, query: 'regress' }, 0, NOW).folders)).toEqual(['Regression']);
    expect(names(search(data, { ...NO_FILTERS, query: 'through the api' }, 0, NOW).workflows)).toEqual(['Create wallet']);
    expect(names(search(data, { ...NO_FILTERS, query: 'retail' }, 0, NOW).projects)).toEqual(['HelloBank']);
    expect(search(data, { ...NO_FILTERS, query: 'zzz' }, 0, NOW)).toEqual({ projects: [], folders: [], workflows: [] });
  });
  it('can be scoped to one project', () => {
    expect(names(search(data, { ...NO_FILTERS, query: 'log' }, 1, NOW).workflows)).toEqual([]);
    expect(names(search(data, { ...NO_FILTERS, query: 'log' }, 2, NOW).workflows)).toEqual(['Login']);
    expect(names(search(data, { ...NO_FILTERS, status: 'SUCCESS' }, 1, NOW).workflows)).toEqual(['Create wallet']);
  });
});

describe('filters work together with search', () => {
  it('filters by execution status', () => {
    expect(names(search(data, { ...NO_FILTERS, status: 'SUCCESS' }, 0, NOW).workflows)).toEqual(['Create wallet', 'Login']);
    expect(names(search(data, { ...NO_FILTERS, status: 'FAILED' }, 0, NOW).workflows)).toEqual(['Goal reached']);
    expect(names(search(data, { ...NO_FILTERS, status: 'NEVER' }, 0, NOW).workflows)).toEqual(['Top level flow']);
  });
  it('filters by recently updated and recently executed', () => {
    expect(names(search(data, { ...NO_FILTERS, updated: '1d' }, 0, NOW).workflows)).toEqual(['Goal reached', 'Login']);
    expect(names(search(data, { ...NO_FILTERS, updated: '7d' }, 0, NOW).workflows)).toEqual(['Create wallet', 'Goal reached', 'Login']);
    expect(names(search(data, { ...NO_FILTERS, executed: '1d' }, 0, NOW).workflows)).toEqual(['Create wallet', 'Login']);
    expect(names(search(data, { ...NO_FILTERS, executed: '30d' }, 0, NOW).workflows)).toEqual(['Create wallet', 'Goal reached', 'Login', 'Token helper']);
    expect(names(search(data, { ...NO_FILTERS, executed: '30d' }, 0, NOW).workflows)).not.toContain('Top level flow'); // never executed
  });
  it('combines everything', () => {
    const f = { query: 'wallet', status: 'SUCCESS' as const, updated: '7d' as const, executed: '1d' as const };
    expect(names(search(data, f, 0, NOW).workflows)).toEqual(['Create wallet']);
    expect(search(data, f, 0, NOW).projects).toEqual([]); // workflow-level filters apply to workflows only
    expect(matchesWorkflowFilters(workflows[1], f, NOW)).toBe(false);
  });
  it('knows when it is filtering', () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, query: ' ' })).toBe(false);
    expect(isFiltering({ ...NO_FILTERS, query: 'a' })).toBe(true);
    expect(isFiltering({ ...NO_FILTERS, status: 'NEVER' })).toBe(true);
  });
  it('stays fast with hundreds of workflows', () => {
    const many: Workflow[] = Array.from({ length: 600 }, (_, i) => wf({ id: 100 + i, name: `Flow ${i}`, folderId: [0, 10, 11, 12][i % 4], lastStatus: i % 3 ? 'SUCCESS' : undefined, lastRunAt: ago(i * H) }));
    const t = performance.now();
    for (let k = 0; k < 20; k++) search({ projects, folders, workflows: many }, { ...NO_FILTERS, query: 'flow 1', executed: '7d' }, 1, NOW);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe('timeAgo', () => {
  it('reads naturally', () => {
    expect(timeAgo(ago(10_000), NOW)).toBe('just now');
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5 min ago');
    expect(timeAgo(ago(3 * H), NOW)).toBe('3 h ago');
    expect(timeAgo(ago(2 * D), NOW)).toBe('2 d ago');
    expect(timeAgo(null, NOW)).toBe('');
  });
});
