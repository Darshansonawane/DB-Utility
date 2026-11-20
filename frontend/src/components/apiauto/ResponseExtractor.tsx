import { useMemo } from 'react';
import { api } from '../../services/api';
import type { ApiExtraction, Folder } from '../../types';
import ExtractPicker, { type PickEntry } from './ExtractPicker';

/** Flattens a JSON response into selectable leaf paths (data.customerId, items[0].id …). */
export function flattenJson(text: string | undefined): PickEntry[] {
  if (!text) return [];
  let root: unknown;
  try { root = JSON.parse(text); } catch { return []; }
  const out: PickEntry[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (out.length >= 300) return;
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      if (depth > 6) return;
      v.slice(0, 50).forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
    } else if (typeof v === 'object') {
      if (depth > 6) return;
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
    } else if (path) {
      out.push({ key: path, value: String(v) });
    }
  };
  walk(root, '', 0);
  return out;
}

export function nameFromPath(path: string): string {
  const last = path.replace(/\[\d+]/g, '').split('.').filter(Boolean).pop() ?? 'value';
  const clean = last.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z_]/.test(clean) ? clean : `v_${clean}`;
}

/** "Save fields from this response as variables" panel shown under a Send result. */
export default function ResponseExtractor({ body, folders, requestName, onRemember }: {
  body?: string; folders: Folder[]; requestName?: string; onRemember?: (rules: ApiExtraction[]) => void;
}) {
  const entries = useMemo(() => flattenJson(body), [body]);
  return (
    <ExtractPicker title="Extract values from this response" keyLabel="JSON path" entries={entries} folders={folders} canRemember={!!onRemember}
      defaultName={nameFromPath}
      onSave={async (items, remember) => {
        await api.saveVariablesBulk(`api:${requestName || 'request'}`, items.map((i) => ({ name: i.name, value: i.value, secret: i.secret, folderId: i.folderId || null })));
        if (remember && onRemember) onRemember(items.map((i) => ({ variable: i.name, source: 'BODY', path: i.key, secret: i.secret, folderId: i.folderId || null })));
      }} />
  );
}
