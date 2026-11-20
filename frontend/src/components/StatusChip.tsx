import { Chip } from '@mui/material';

const COLORS: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  SUCCESS: 'success', NO_DATA: 'warning', FAILED: 'error', BLOCKED: 'warning', RUNNING: 'info', PENDING: 'default',
  STOPPED: 'warning', SKIPPED: 'default', PARTIAL: 'warning', INCOMPLETE: 'default', CONNECTED: 'success',
  ROLLED_BACK: 'error', REJECTED: 'error', PREVIEWED: 'info', BLOCKED_WRITE: 'warning',
};

export default function StatusChip({ status }: { status: string }) {
  const label = status === 'NO_DATA' ? 'NO RECORDS' : status.replace('_', ' ');
  return <Chip size="small" label={label} color={COLORS[status] ?? 'default'} variant={status === 'PENDING' ? 'outlined' : 'filled'}
    className={status === 'RUNNING' ? 'chip-running' : status === 'SUCCESS' ? 'badge-pop' : undefined} />;
}
