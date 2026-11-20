import { useEffect, useRef, type ReactNode } from 'react';
import { Box } from '@mui/material';

/** What a step card should look like for a run status. */
export function stepToneOf(status: string | undefined): 'idle' | 'running' | 'success' | 'failed' | 'warn' {
  if (status === 'RUNNING') return 'running';
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'failed';
  if (status === 'NO_DATA' || status === 'BLOCKED' || status === 'STOPPED') return 'warn';
  return 'idle';
}

/**
 * Frame around one workflow step. While the step runs it glows with a sweeping progress bar and scrolls itself into view;
 * when it finishes it plays a one-time burst (green for success, a shake for failure). See .step-* in styles/motion.css.
 */
export default function StepCard({ status, children }: { status: string | undefined; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const tone = stepToneOf(status);
  useEffect(() => {
    if (tone === 'running') ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [tone]);
  return <Box ref={ref} className={`step-card step-${tone}`} data-testid={`step-card-${tone}`}>{children}</Box>;
}
