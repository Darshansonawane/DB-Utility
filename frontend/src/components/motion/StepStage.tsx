import { useEffect, useRef, useState } from 'react';
import { Box, Collapse, Typography } from '@mui/material';
import { CountUp, DbSuccessIcon, DbWorkingIcon } from './DbSuccess';

interface Props {
  order: number; name: string; status: string | undefined;
  rows?: number | null; durationMs?: number | null; error?: string | null;
}
type Phase = 'hidden' | 'running' | 'success' | 'failed' | 'warn';

const END_MS = 3200;
const SPARKS = Array.from({ length: 14 }, (_, i) => i * (360 / 14));

/**
 * A large, attention-grabbing stage shown above a workflow step while it executes: a query node firing data packets across a track into a
 * big database cylinder with a live timer. When the step finishes it becomes a celebration (burst + check + counted rows) or a failure
 * banner for a few seconds, then folds away. A step that is already finished when the page opens shows nothing.
 */
export default function StepStage({ order, name, status, rows, durationMs, error }: Props) {
  const [phase, setPhase] = useState<Phase>(status === 'RUNNING' ? 'running' : 'hidden');
  const prev = useRef(status);
  const [elapsed, setElapsed] = useState(0);
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    const was = prev.current;
    prev.current = status;
    if (status === was) return;
    if (status === 'RUNNING') { setPhase('running'); return; }
    const terminal = status === 'SUCCESS' ? 'success' : status === 'FAILED' ? 'failed' : status === 'NO_DATA' || status === 'BLOCKED' ? 'warn' : null;
    // only a step seen going from not-finished to finished is celebrated: reopening an old run stays quiet
    if (terminal && (was === 'RUNNING' || was === 'PENDING' || was === undefined)) {
      setPhase(terminal); setBurst((n) => n + 1);
      const t = setTimeout(() => setPhase('hidden'), END_MS);
      return () => clearTimeout(t);
    }
    setPhase('hidden');
  }, [status]);

  useEffect(() => {
    if (phase !== 'running') { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - t0), 100);
    return () => clearInterval(id);
  }, [phase]);

  const tone = phase === 'failed' ? 'bad' : phase === 'warn' ? 'warn' : phase === 'success' ? 'ok' : 'run';
  const seconds = (ms: number) => (ms / 1000).toFixed(1);
  return (
    <Collapse in={phase !== 'hidden'} unmountOnExit timeout={320}>
      <Box className={`stage stage-${tone}`} data-testid={`step-stage-${phase}`} role="status" aria-live="polite" key={`${phase}-${burst}`}>
        <Box className="stage-node"><span>{phase === 'running' ? 'RUN' : `#${order}`}</span></Box>
        <Box className="stage-track" aria-hidden="true">
          <span className="stage-rail" />
          {phase === 'running' && [0, 1, 2, 3, 4].map((i) => <span key={i} className="stage-packet" style={{ ['--i' as string]: i }} />)}
        </Box>
        <Box className="stage-db">
          {phase === 'running' && <DbWorkingIcon size={124} />}
          {phase === 'success' && <><DbSuccessIcon size={124} />{SPARKS.map((a, i) => <span key={i} className="stage-spark" style={{ ['--a' as string]: `${a}deg`, ['--d' as string]: `${(i % 4) * 40}ms` }} />)}</>}
          {phase === 'warn' && <DbSuccessIcon size={124} write />}
          {phase === 'failed' && <Box className="stage-x">✕</Box>}
        </Box>
        <Box className="stage-text">
          {phase === 'running' && <>
            <Typography className="stage-title">Executing step {order}…</Typography>
            <Typography className="stage-sub">{name}</Typography>
            <Typography className="stage-time">{seconds(elapsed)} s</Typography>
          </>}
          {phase === 'success' && <>
            <Typography className="stage-title">Step {order} complete</Typography>
            <Typography className="stage-sub">{rows != null && rows > 0 ? <><b><CountUp value={rows} /></b> row{rows === 1 ? '' : 's'} retrieved</> : 'Executed successfully'}{durationMs != null ? ` in ${seconds(durationMs)} s` : ''}</Typography>
          </>}
          {phase === 'warn' && <>
            <Typography className="stage-title">Step {order}: no records</Typography>
            <Typography className="stage-sub">{name}</Typography>
          </>}
          {phase === 'failed' && <>
            <Typography className="stage-title">Step {order} failed</Typography>
            <Typography className="stage-sub" noWrap title={error ?? undefined}>{error ?? name}</Typography>
          </>}
        </Box>
      </Box>
    </Collapse>
  );
}
