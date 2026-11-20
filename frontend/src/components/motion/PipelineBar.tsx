import { Box, Tooltip } from '@mui/material';

export interface PipelineStep { order: number; name: string; status: string }

const tone = (s: string) => (s === 'RUNNING' ? 'run' : s === 'SUCCESS' ? 'ok' : s === 'FAILED' ? 'bad' : s === 'NO_DATA' || s === 'BLOCKED' || s === 'STOPPED' ? 'warn' : 'idle');

/**
 * A compact pipeline overview of a workflow run: one node per step joined by a line. The running node pulses, finished nodes
 * turn green with a check, failures turn red, and the line fills as the run moves along. See .pipe-* in styles/motion.css.
 */
export default function PipelineBar({ steps }: { steps: PipelineStep[] }) {
  if (steps.length === 0) return null;
  const done = (s: PipelineStep) => s.status === 'SUCCESS' || s.status === 'NO_DATA';
  return (
    <Box className="pipe" role="list" aria-label="workflow progress" data-testid="pipeline">
      {steps.map((s, i) => (
        <Box key={s.order} className="pipe-seg" role="listitem">
          {i > 0 && <span className={`pipe-line ${done(steps[i - 1]) ? 'filled' : steps[i - 1].status === 'RUNNING' ? 'filling' : ''}`} />}
          <Tooltip title={`Step ${s.order}: ${s.name} (${s.status.replace('_', ' ').toLowerCase()})`}>
            <span className={`pipe-node pipe-${tone(s.status)}`} data-testid={`pipe-node-${s.order}`}>
              {tone(s.status) === 'ok' ? (
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" className="check-draw" aria-hidden="true"><path d="M4.5 10.5 8.5 14.5 15.5 6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : tone(s.status) === 'bad' ? '!' : s.order}
            </span>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}
