import { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/** Counts from 0 up to `value` once (instantly when the user prefers reduced motion). */
export function CountUp({ value, duration = 700 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || value <= 0 || typeof requestAnimationFrame === 'undefined') { setN(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{n.toLocaleString()}</>;
}

/**
 * A database cylinder that receives three "data packets" and then confirms with a check mark. Plays once when mounted:
 * give it a changing `key` to replay it for every run. See .db-* in styles/motion.css.
 */
export function DbSuccessIcon({ size = 44, write = false }: { size?: number; write?: boolean }) {
  return (
    <svg className="db-success" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" data-testid="db-success-icon">
      <g className="db-cyl" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="28" cy="12" rx="12" ry="4.5" />
        <path d="M16 12v10c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V12" />
        <path d="M16 22v10c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V22" />
      </g>
      <g className="db-packets" fill="currentColor">
        <rect className="db-packet p1" x="1" y="15" width="8" height="3.4" rx="1.7" />
        <rect className="db-packet p2" x="1" y="22" width="8" height="3.4" rx="1.7" />
        <rect className="db-packet p3" x="1" y="29" width="8" height="3.4" rx="1.7" />
      </g>
      <g className="db-check">
        <circle cx="38" cy="38" r="8" fill={write ? '#ed6c02' : '#2e7d32'} />
        <path d="M34 38.3 37 41.2 42.2 35" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** Success banner for a finished query: animated database icon plus the row count counting up. */
export function QuerySuccessBanner({ rowCount, affectedRows, durationMs, runKey }: { rowCount: number; affectedRows?: number | null; durationMs: number; runKey: string | number }) {
  const write = affectedRows !== null && affectedRows !== undefined;
  const n = write ? affectedRows! : rowCount;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" role="status" className="db-banner"
      sx={{ color: write ? 'warning.main' : 'success.main', border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 0.75, bgcolor: 'action.hover' }}>
      <DbSuccessIcon key={runKey} write={write} />
      <Box>
        <Typography variant="subtitle2" color="text.primary" sx={{ lineHeight: 1.2 }}>
          {write ? 'Changes applied' : 'Query completed'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          <b><CountUp key={runKey} value={n} /></b> row{n === 1 ? '' : 's'} {write ? 'affected' : 'returned'} in {durationMs < 1000 ? `${durationMs} ms` : `${(durationMs / 1000).toFixed(2)} s`}
        </Typography>
      </Box>
    </Stack>
  );
}

/** The same database cylinder, endlessly receiving data packets: shown in a step header while it executes. */
export function DbWorkingIcon({ size = 36 }: { size?: number }) {
  return (
    <svg className="db-success db-working" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" data-testid="db-working-icon">
      <g className="db-cyl" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="28" cy="12" rx="12" ry="4.5" />
        <path d="M16 12v10c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V12" />
        <path d="M16 22v10c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V22" />
      </g>
      <g fill="currentColor">
        <rect className="db-packet p1" x="1" y="15" width="8" height="3.4" rx="1.7" />
        <rect className="db-packet p2" x="1" y="22" width="8" height="3.4" rx="1.7" />
        <rect className="db-packet p3" x="1" y="29" width="8" height="3.4" rx="1.7" />
      </g>
    </svg>
  );
}
