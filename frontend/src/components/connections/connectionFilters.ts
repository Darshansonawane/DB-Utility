import type { ConnectionView, DbType, StatusView } from '../../types';
import { canonicalEnv, envLabel } from '../../utils/environments';

export type TypeFilter = 'ALL' | DbType;
export type EnvFilter = 'ALL' | 'QA' | 'STAGING' | 'DEV';
export type StatusFilter = 'ALL' | 'CONNECTED' | 'IDLE' | 'FAILED';
export type SortKey = 'name' | 'recent' | 'type' | 'env';
export type GroupKey = 'none' | 'type' | 'env';

export interface Filters { query: string; type: TypeFilter; env: EnvFilter; status: StatusFilter }
export const NO_FILTERS: Filters = { query: '', type: 'ALL', env: 'ALL', status: 'ALL' };

/** connected: live and healthy. lost: live but the last health check failed. failed: the last connect/test attempt failed. idle: otherwise. */
export type ConnState = 'connected' | 'lost' | 'failed' | 'idle';

export function connState(c: ConnectionView, health?: StatusView, failed?: boolean): ConnState {
  if (c.connected) return health && !health.connected ? 'lost' : 'connected';
  return failed ? 'failed' : 'idle';
}

const TYPE_TEXT: Record<DbType, string> = { MYSQL: 'mysql', MONGODB: 'mongodb mongo' };
const haystacks = new WeakMap<ConnectionView, string>();

/** One lower-case search string per connection (name, host, username, owner, environment and type), built once and cached. */
function haystack(c: ConnectionView): string {
  let h = haystacks.get(c);
  if (h === undefined) {
    h = [c.name, c.host, String(c.port), c.username, c.ownerName, c.environment, envLabel(c.environment), TYPE_TEXT[c.dbType]].filter(Boolean).join(' ').toLowerCase();
    haystacks.set(c, h);
  }
  return h;
}

export function matchesQuery(c: ConnectionView, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const h = haystack(c);
  return tokens.every((t) => h.includes(t));
}

export function stateMatches(state: ConnState, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'CONNECTED') return state === 'connected';
  if (filter === 'IDLE') return state === 'idle';
  return state === 'failed' || state === 'lost';
}

export function filterConnections(list: ConnectionView[], f: Filters, stateOf: (c: ConnectionView) => ConnState): ConnectionView[] {
  return list.filter((c) =>
    (f.type === 'ALL' || c.dbType === f.type)
    && (f.env === 'ALL' || canonicalEnv(c.environment) === f.env)
    && stateMatches(stateOf(c), f.status)
    && matchesQuery(c, f.query));
}

const ENV_ORDER = ['QA', 'STAGING', 'DEV'];
const byName = (a: ConnectionView, b: ConnectionView) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

export function sortConnections(list: ConnectionView[], key: SortKey): ConnectionView[] {
  const out = [...list];
  const envRank = (c: ConnectionView) => { const i = ENV_ORDER.indexOf(canonicalEnv(c.environment)); return i < 0 ? 99 : i; };
  switch (key) {
    case 'recent': return out.sort((a, b) => b.id - a.id);
    case 'type': return out.sort((a, b) => a.dbType.localeCompare(b.dbType) || byName(a, b));
    case 'env': return out.sort((a, b) => envRank(a) - envRank(b) || byName(a, b));
    default: return out.sort(byName);
  }
}

export interface Group { key: string; label: string; items: ConnectionView[] }

export function groupConnections(list: ConnectionView[], by: GroupKey): Group[] {
  if (by === 'none') return [{ key: 'all', label: 'All connections', items: list }];
  const groups = new Map<string, Group>();
  for (const c of list) {
    const key = by === 'type' ? c.dbType : canonicalEnv(c.environment);
    const label = by === 'type' ? (c.dbType === 'MONGODB' ? 'MongoDB' : 'MySQL') : envLabel(c.environment);
    const g = groups.get(key);
    if (g) g.items.push(c); else groups.set(key, { key, label, items: [c] });
  }
  const order = by === 'type' ? ['MYSQL', 'MONGODB'] : ENV_ORDER;
  return [...groups.values()].sort((a, b) => (order.indexOf(a.key) + 100) % 100 - (order.indexOf(b.key) + 100) % 100);
}
