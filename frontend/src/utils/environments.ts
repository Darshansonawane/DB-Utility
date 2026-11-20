/** Environments: QA, Staging (formerly UAT) and Development. The backend stores the codes QA, STAGING and DEV. */
export const ENV_OPTIONS = [
  { value: 'QA', label: 'QA' },
  { value: 'STAGING', label: 'Staging' },
  { value: 'DEV', label: 'Development' },
] as const;

export type EnvCode = (typeof ENV_OPTIONS)[number]['value'];

/** Accepts old spellings too (UAT, Development). */
export function canonicalEnv(raw?: string | null): string {
  const e = (raw ?? '').trim().toUpperCase();
  return e === 'UAT' ? 'STAGING' : e === 'DEVELOPMENT' ? 'DEV' : e;
}

export function envLabel(raw?: string | null): string {
  const c = canonicalEnv(raw);
  return ENV_OPTIONS.find((o) => o.value === c)?.label ?? (raw ?? '');
}

export function envColor(raw?: string | null): 'success' | 'warning' | 'info' {
  const c = canonicalEnv(raw);
  return c === 'STAGING' ? 'warning' : c === 'DEV' ? 'info' : 'success';
}
