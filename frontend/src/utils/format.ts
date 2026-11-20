import type { Column, QueryParameter } from '../types';

export function cell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function rowsToObjects(columns: Column[], rows: unknown[][]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.name, r[i]])));
}

/** Initial form values from parameter definitions. */
export function initialValues(params: QueryParameter[]): Record<string, string> {
  return Object.fromEntries(params.map((p) => [p.name, p.defaultValue ?? '']));
}

export function missingRequired(params: QueryParameter[], values: Record<string, string>): string[] {
  return params.filter((p) => p.required && !(values[p.name] ?? '').trim()).map((p) => p.label);
}

export function ms(n?: number | null): string {
  if (n === undefined || n === null) return '-';
  return n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(2)} s`;
}
