import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, Chip, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api, errMsg } from '../../services/api';
import type { ApiWorkflowDef, RunSummary } from '../../types';
import { fmtMs, fmtTime, RunChip } from './common';
import RunDetailDialog from './RunDetailDialog';

function RunsTable({ runs, onOpen, onStop, selection, onSelection }: {
  runs: RunSummary[]; onOpen: (id: string) => void; onStop?: (id: string) => void; selection?: string[]; onSelection?: (ids: string[]) => void;
}) {
  const selectable = !!onSelection;
  const all = selectable && runs.length > 0 && runs.every((r) => selection?.includes(r.runId));
  return (
    <Card variant="outlined">
      <Table size="small">
        <TableHead><TableRow>{selectable && <TableCell padding="checkbox"><Checkbox size="small" checked={all} indeterminate={!all && (selection?.length ?? 0) > 0} inputProps={{ 'aria-label': 'select all runs' }} onChange={(e) => onSelection!(e.target.checked ? runs.map((r) => r.runId) : [])} /></TableCell>}<TableCell>Workflow</TableCell><TableCell>Status</TableCell><TableCell>Started</TableCell><TableCell>Duration</TableCell><TableCell>Steps</TableCell><TableCell>Result</TableCell><TableCell align="right" /></TableRow></TableHead>
        <TableBody>
          {runs.length === 0 && <TableRow><TableCell colSpan={8}>Nothing here yet.</TableCell></TableRow>}
          {runs.map((r) => (
            <TableRow key={r.runId} hover sx={{ cursor: 'pointer' }} onClick={() => onOpen(r.runId)}>
              {selectable && <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}><Checkbox size="small" checked={!!selection?.includes(r.runId)} inputProps={{ 'aria-label': `select run ${r.runId}` }}
                onChange={(e) => onSelection!(e.target.checked ? [...(selection ?? []), r.runId] : (selection ?? []).filter((x) => x !== r.runId))} /></TableCell>}
              <TableCell>{r.workflowName}</TableCell>
              <TableCell><RunChip status={r.status} /></TableCell>
              <TableCell>{fmtTime(r.startedAt)}</TableCell>
              <TableCell>{fmtMs(r.durationMs)}</TableCell>
              <TableCell>{r.passedSteps}/{r.totalSteps} passed{r.failedSteps > 0 && <Chip size="small" color="error" label={`${r.failedSteps} failed`} sx={{ ml: 1 }} />}</TableCell>
              <TableCell sx={{ maxWidth: 360, wordBreak: 'break-word' }}><Typography variant="caption" color={r.error ? 'error' : 'text.secondary'}>{r.error ?? ''}</Typography></TableCell>
              <TableCell align="right">{onStop && <Button size="small" color="warning" onClick={(e) => { e.stopPropagation(); onStop(r.runId); }}>Stop</Button>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

export default function ApiRunsTab({ workflows, openRunIds, onConsumed }: { workflows: ApiWorkflowDef[]; openRunIds: string[]; onConsumed: () => void }) {
  const [active, setActive] = useState<RunSummary[]>([]);
  const [maxConcurrent, setMax] = useState(0);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [filter, setFilter] = useState<number | ''>('');
  const [detail, setDetail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, h] = await Promise.all([api.activeApiRuns(), api.apiRuns(filter === '' ? undefined : filter, 50)]);
      setActive(a.runs); setMax(a.maxConcurrent); setHistory(h); setErr(null);
    } catch (e) { setErr(errMsg(e)); }
  }, [filter]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  // a run (or batch) was just started: open the first one
  useEffect(() => { if (openRunIds.length > 0) { setDetail(openRunIds[0]); onConsumed(); } }, [openRunIds, onConsumed]);

  const stop = async (id: string) => { try { await api.cancelApiRun(id); void refresh(); } catch (e) { setErr(errMsg(e)); } };
  const clearAll = async () => {
    const scope = filter === '' ? 'ALL execution history (every workflow)' : `the execution history of "${workflows.find((w) => w.id === filter)?.name}"`;
    if (!window.confirm(`Clear ${scope}?\n\nThis permanently deletes the run records and reports. Saved requests, workflows, queries and variables are NOT affected. Runs in progress are kept.`)) return;
    try { const r = await api.clearApiRuns(filter === '' ? undefined : filter); setSel([]); setNote(`Cleared ${r.deleted} run(s).`); void refresh(); } catch (e) { setErr(errMsg(e)); }
  };
  const deleteSelected = async () => {
    if (!window.confirm(`Delete ${sel.length} selected run(s)? This cannot be undone.`)) return;
    try { const r = await api.deleteApiRuns(sel); setSel([]); setNote(`Deleted ${r.deleted} run(s).`); void refresh(); } catch (e) { setErr(errMsg(e)); }
  };
  const running = active.filter((r) => r.status === 'RUNNING').length;
  const finished = history.filter((r) => r.status !== 'RUNNING' && r.status !== 'QUEUED');

  return (
    <Stack spacing={2}>
      {err && <Alert severity="error">{err}</Alert>}
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="subtitle1" fontWeight={700}>Active runs</Typography>
        <Chip size="small" color={running > 0 ? 'info' : 'default'} label={`${running} running / ${active.length - running} queued · up to ${maxConcurrent} at once`} />
      </Stack>
      <RunsTable runs={active} onOpen={setDetail} onStop={(id) => void stop(id)} />
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="subtitle1" fontWeight={700}>History</Typography>
        <TextField size="small" select label="Workflow" value={filter} sx={{ minWidth: 240 }} onChange={(e) => setFilter(e.target.value === '' ? '' : Number(e.target.value))}>
          <MenuItem value="">All workflows</MenuItem>
          {workflows.map((w) => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
        </TextField>
        <Button size="small" color="warning" variant="outlined" disabled={sel.length === 0} onClick={deleteSelected}>Delete selected ({sel.length})</Button>
        <Button size="small" color="error" variant="outlined" disabled={finished.length === 0} onClick={clearAll}>Clear history</Button>
      </Stack>
      {note && <Alert severity="success" onClose={() => setNote(null)}>{note}</Alert>}
      <RunsTable runs={finished} onOpen={setDetail} selection={sel} onSelection={setSel} />
      {detail && <RunDetailDialog runId={detail} onClose={() => setDetail(null)} />}
    </Stack>
  );
}
