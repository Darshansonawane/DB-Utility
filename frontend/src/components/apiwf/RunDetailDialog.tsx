import { useEffect, useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { api, errMsg } from '../../services/api';
import type { ApiRunView } from '../../types';
import { fmtMs, fmtTime, isFinal, RunChip } from './common';

/** Live view of one API workflow run (polls until it finishes). */
export default function RunDetailDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<ApiRunView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api.apiRun(runId);
        if (stop) return;
        setRun(r);
        if (!isFinal(r.status)) timer = setTimeout(tick, 1500);
      } catch (e) {
        if (!stop) setErr(errMsg(e));
      }
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [runId]);

  const stopRun = async () => { try { setRun(await api.cancelApiRun(runId)); } catch (e) { setErr(errMsg(e)); } };

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{run ? run.workflowName : 'Run'} {run && <RunChip status={run.status} />}</DialogTitle>
      <DialogContent dividers>
        {err && <Alert severity="error">{err}</Alert>}
        {run && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Typography variant="body2">Started: {fmtTime(run.startedAt)}</Typography>
              <Typography variant="body2">Duration: {fmtMs(run.durationMs)}</Typography>
              <Typography variant="body2">By: {run.triggeredBy ?? '-'}</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{run.runId}</Typography>
            </Stack>
            {Object.keys(run.inputs).length > 0 && (
              <Typography variant="body2">Run variables: {Object.entries(run.inputs).map(([k, v]) => `${k}=${v}`).join(', ')}</Typography>
            )}
            {run.error && <Alert severity="error">{run.error}</Alert>}
            <Table size="small">
              <TableHead><TableRow><TableCell>#</TableCell><TableCell>Step</TableCell><TableCell>Status</TableCell><TableCell>Attempts</TableCell><TableCell>HTTP</TableCell><TableCell>Time</TableCell><TableCell>Details</TableCell></TableRow></TableHead>
              <TableBody>
                {run.steps.map((s) => (
                  <TableRow key={s.order} hover sx={{ verticalAlign: 'top' }}>
                    <TableCell>{s.order}</TableCell>
                    <TableCell>
                      <b>{s.name}</b><br /><Typography variant="caption">{s.method} {s.requestName}</Typography>
                    </TableCell>
                    <TableCell><RunChip status={s.status} /></TableCell>
                    <TableCell>{s.attempts ? `${s.attempts}${s.maxAttempts > 1 ? ` / ${s.maxAttempts}` : ''}` : '-'}</TableCell>
                    <TableCell>{s.httpStatus ?? '-'}</TableCell>
                    <TableCell>{fmtMs(s.durationMs)}</TableCell>
                    <TableCell sx={{ maxWidth: 420, wordBreak: 'break-word' }}>
                      {s.liveStatus && <Typography variant="body2" color="info.main">{s.liveStatus}</Typography>}
                      {s.error && <Typography variant="body2" color="error">{s.error}</Typography>}
                      {s.extracted?.length > 0 && (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                          {s.extracted.map((x) => <Chip key={x.variable} size="small" variant="outlined" color={x.found ? 'primary' : 'error'} label={x.found ? `${x.variable} = ${x.value}` : `${x.variable} not found`} />)}
                        </Stack>
                      )}
                      {s.responseSnippet && (
                        <Box component="details" sx={{ mt: 0.5 }}><summary>Last response</summary>
                          <Box component="pre" sx={{ m: 0, fontSize: 11, maxHeight: 160, overflow: 'auto' }}>{s.responseSnippet}</Box></Box>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {run && !isFinal(run.status) && <Button color="warning" onClick={stopRun}>Stop run</Button>}
        {run && <Button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(run, null, 2))}>Copy JSON</Button>}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
