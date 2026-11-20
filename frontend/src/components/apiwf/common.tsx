import { Chip } from '@mui/material';

const COLORS: Record<string, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  SUCCESS: 'success', FAILED: 'error', TIMED_OUT: 'error', CANCELLED: 'warning', STOPPED: 'warning', RUNNING: 'info', QUEUED: 'default', PENDING: 'default', SKIPPED: 'default',
};

export function RunChip({ status }: { status?: string }) {
  if (!status) return <Chip size="small" label="never run" variant="outlined" />;
  return <Chip size="small" color={COLORS[status] ?? 'default'} label={status.replace('_', ' ')} variant={status === 'SKIPPED' || status === 'PENDING' || status === 'QUEUED' ? 'outlined' : 'filled'} />;
}

export function fmtMs(ms?: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function fmtTime(t?: string | null): string {
  return t ? new Date(t).toLocaleString() : '-';
}

export const isFinal = (s?: string) => !!s && !['QUEUED', 'RUNNING'].includes(s);
