import { Box } from '@mui/material';

export type FlowState = 'idle' | 'running' | 'done' | 'failed';

/** Maps a step status to what the connector below it should show. */
export function flowStateOf(status: string | undefined): FlowState {
  if (status === 'RUNNING') return 'running';
  if (status === 'SUCCESS' || status === 'NO_DATA') return 'done';
  if (status === 'FAILED' || status === 'BLOCKED' || status === 'STOPPED') return 'failed';
  return 'idle';
}

/** The line between two workflow steps: data dots travel along it while a step runs, and once when it has succeeded. */
export default function FlowConnector({ state }: { state: FlowState }) {
  return (
    <Box className={`flow-connector flow-${state}`} data-testid={`flow-${state}`} aria-hidden="true">
      <span className="flow-line" />
      {state !== 'idle' && state !== 'failed' && <><span className="flow-dot d1" /><span className="flow-dot d2" /></>}
    </Box>
  );
}
