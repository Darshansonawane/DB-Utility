import { Chip, CircularProgress, Tooltip } from '@mui/material';
import AnimatedCheck from '../AnimatedCheck';
import type { ConnState } from './connectionFilters';

interface Props {
  state: ConnState;
  connecting?: boolean;
  active?: boolean;
  /** true for a moment after the state just changed, so the badge animates in */
  fresh?: boolean;
  message?: string;
}

/** Idle -> Connecting... -> Connected (check draws in) / Failed (shakes once). */
export default function ConnectionStatusBadge({ state, connecting, active, fresh, message }: Props) {
  if (connecting) {
    return <Chip size="small" color="info" variant="outlined" icon={<CircularProgress size={12} thickness={6} />} label="Connecting…" aria-live="polite" />;
  }
  if (state === 'connected') {
    return (
      <Chip size="small" color="success" className={fresh ? 'badge-pop' : undefined} icon={<AnimatedCheck size={14} animate={!!fresh} />}
        label={active ? 'Connected · active' : 'Connected'} />
    );
  }
  if (state === 'lost') {
    return <Tooltip title={message ?? 'The connection no longer responds'}><Chip size="small" color="error" className={fresh ? 'shake' : undefined} label="Connection lost" /></Tooltip>;
  }
  if (state === 'failed') {
    return <Tooltip title={message ?? 'The last attempt to connect failed'}><Chip size="small" color="error" variant="outlined" className={fresh ? 'shake' : undefined} label="Failed" /></Tooltip>;
  }
  return <Chip size="small" variant="outlined" label="Idle" />;
}
