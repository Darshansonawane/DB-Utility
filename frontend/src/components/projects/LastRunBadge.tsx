import { Chip, Tooltip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ScheduleIcon from '@mui/icons-material/Schedule';
import type { Workflow } from '../../types';
import { timeAgo } from '../../utils/time';
import { runKind } from './workflowHierarchy';

/** Last execution of a workflow: succeeded, failed, something in between, or never executed. */
export default function LastRunBadge({ w }: { w: Workflow }) {
  const kind = runKind(w);
  const ago = timeAgo(w.lastRunAt);
  const when = w.lastRunAt ? new Date(w.lastRunAt).toLocaleString() : '';
  if (kind === 'never') return <Chip size="small" variant="outlined" icon={<ScheduleIcon />} label="Never run" />;
  if (kind === 'success') return <Tooltip title={`Last run succeeded ${when}`}><Chip size="small" color="success" variant="outlined" icon={<CheckCircleIcon />} label={`Succeeded · ${ago}`} /></Tooltip>;
  if (kind === 'failed') return <Tooltip title={`Last run failed ${when}`}><Chip size="small" color="error" variant="outlined" icon={<ErrorIcon />} label={`Failed · ${ago}`} /></Tooltip>;
  return <Tooltip title={`Last run ${when}`}><Chip size="small" color="warning" variant="outlined" label={`${(w.lastStatus ?? '').toLowerCase()} · ${ago}`} /></Tooltip>;
}
