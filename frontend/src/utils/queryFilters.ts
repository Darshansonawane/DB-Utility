import type { SavedQuery } from '../types';
import { canonicalEnv } from './environments';

export interface QueryFilters { search: string; category: string; type: string; env: string; enabled: string }
export const NO_FILTERS: QueryFilters = { search: '', category: '', type: '', env: '', enabled: '' };

/** Pure client-side filter: every word of the search must appear in the name, description, category, database or SQL. */
export function filterQueries(all: SavedQuery[], f: QueryFilters): SavedQuery[] {
  const tokens = f.search.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((q) => {
    if (f.category && q.category !== f.category) return false;
    if (f.type && q.queryType !== f.type) return false;
    // a query with no environments is available everywhere
    if (f.env && q.environments.length > 0 && !q.environments.some((e) => canonicalEnv(e) === f.env)) return false;
    if (f.enabled && String(q.enabled) !== (f.enabled === 'ENABLED' ? 'true' : 'false')) return false;
    if (tokens.length === 0) return true;
    const hay = `${q.name} ${q.description ?? ''} ${q.category ?? ''} ${q.databaseName ?? ''} ${q.sql ?? ''} ${q.id ?? ''}`.toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

