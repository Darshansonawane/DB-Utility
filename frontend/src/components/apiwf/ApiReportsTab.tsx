import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { api, errMsg } from '../../services/api';
import type { ApiWorkflowDef, OverviewRow, WorkflowReport } from '../../types';
import { fmtMs, fmtTime, RunChip } from './common';
import RunDetailDialog from './RunDetailDialog';

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" fontWeight={700}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Card>
  );
}

export default function ApiReportsTab({ workflows }: { workflows: ApiWorkflowDef[] }) {
  const [overview, setOverview] = useState<OverviewRow[]>([]);
  const [wfId, setWfId] = useState<number | ''>('');
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<WorkflowReport | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.apiReportOverview().then(setOverview).catch((e) => setErr(errMsg(e))); }, []);
  const load = useCallback(async () => {
    if (wfId === '') { setReport(null); return; }
    try { setReport(await api.apiReport(wfId, days)); setErr(null); } catch (e) { setErr(errMsg(e)); }
  }, [wfId, days]);
  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    if (wfId === '') return;
    try {
      const csv = await api.apiReportCsv(wfId, days);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `${report?.workflowName ?? 'api-workflow'}-report.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(errMsg(e)); }
  };
  const maxRuns = Math.max(1, ...(report?.trend.map((d) => d.runs) ?? [1]));

  return (
    <Stack spacing={2}>
      {err && <Alert severity="error">{err}</Alert>}
      <Typography variant="subtitle1" fontWeight={700}>All workflows (last 30 days)</Typography>
      <Card variant="outlined">
        <Table size="small">
          <TableHead><TableRow><TableCell>Workflow</TableCell><TableCell>Steps</TableCell><TableCell>Runs</TableCell><TableCell>Pass rate</TableCell><TableCell>Avg duration</TableCell><TableCell>Last run</TableCell></TableRow></TableHead>
          <TableBody>
            {overview.length === 0 && <TableRow><TableCell colSpan={6}>No workflows yet.</TableCell></TableRow>}
            {overview.map((o) => (
              <TableRow key={o.workflowId} hover sx={{ cursor: 'pointer' }} onClick={() => setWfId(o.workflowId)} selected={wfId === o.workflowId}>
                <TableCell>{o.workflowName}</TableCell><TableCell>{o.steps}</TableCell><TableCell>{o.runs}</TableCell>
                <TableCell>{o.runs ? `${o.passRate.toFixed(0)}%` : '-'}</TableCell><TableCell>{o.runs ? fmtMs(o.avgMs) : '-'}</TableCell>
                <TableCell><RunChip status={o.lastStatus} /> <Typography variant="caption">{fmtTime(o.lastRunAt)}</Typography></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Stack direction="row" spacing={2} alignItems="center">
        <TextField size="small" select label="Workflow report" value={wfId} sx={{ minWidth: 280 }} onChange={(e) => setWfId(e.target.value === '' ? '' : Number(e.target.value))}>
          <MenuItem value="">Select a workflow</MenuItem>
          {workflows.map((w) => <MenuItem key={w.id} value={w.id}>{w.name}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 140 }}>
          {[1, 7, 30, 90, 365].map((d) => <MenuItem key={d} value={d}>{d === 1 ? 'Last 24 hours' : `Last ${d} days`}</MenuItem>)}
        </TextField>
        <Button startIcon={<DownloadIcon />} variant="outlined" disabled={wfId === ''} onClick={download}>Export CSV</Button>
      </Stack>

      {report && (
        <>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Kpi label="Runs" value={String(report.totalRuns)} sub={`${report.passed} passed · ${report.failed + report.timedOut} failed · ${report.cancelled} stopped`} />
            <Kpi label="Pass rate" value={report.totalRuns ? `${report.passRate.toFixed(0)}%` : '-'} />
            <Kpi label="Avg duration" value={fmtMs(report.avgMs)} sub={`min ${fmtMs(report.minMs)} · max ${fmtMs(report.maxMs)}`} />
            <Kpi label="p95 duration" value={fmtMs(report.p95Ms)} />
            <Kpi label="Last run" value={report.lastStatus ? report.lastStatus.replace('_', ' ') : '-'} sub={fmtTime(report.lastRunAt)} />
          </Stack>

          {report.trend.length > 0 && (
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Runs per day</Typography>
              <Stack direction="row" spacing={0.5} alignItems="flex-end" sx={{ height: 110, overflowX: 'auto' }}>
                {report.trend.map((d) => (
                  <Tooltip key={d.day} title={`${d.day}: ${d.runs} runs, ${d.passed} passed, ${d.failed} failed`}>
                    <Box sx={{ width: 26, flex: '0 0 26px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }} aria-label={`${d.day} ${d.runs} runs`}>
                      <Box sx={{ height: `${(d.failed / maxRuns) * 100}%`, bgcolor: 'error.main' }} />
                      <Box sx={{ height: `${((d.runs - d.failed) / maxRuns) * 100}%`, bgcolor: 'success.main', opacity: 0.85 }} />
                    </Box>
                  </Tooltip>
                ))}
              </Stack>
              <Typography variant="caption" color="text.secondary">{report.trend[0].day} → {report.trend[report.trend.length - 1].day} (green passed/other, red failed)</Typography>
            </Card>
          )}

          <Typography variant="subtitle2">Per step</Typography>
          <Card variant="outlined">
            <Table size="small">
              <TableHead><TableRow><TableCell>#</TableCell><TableCell>Step</TableCell><TableCell>Executions</TableCell><TableCell>Failures</TableCell><TableCell>Avg time</TableCell><TableCell>Max time</TableCell><TableCell>Avg attempts</TableCell></TableRow></TableHead>
              <TableBody>
                {report.steps.map((s) => (
                  <TableRow key={s.order}><TableCell>{s.order}</TableCell><TableCell>{s.name}</TableCell><TableCell>{s.runs}</TableCell>
                    <TableCell sx={{ color: s.failures ? 'error.main' : undefined }}>{s.failures}{s.runs ? ` (${((s.failures / s.runs) * 100).toFixed(0)}%)` : ''}</TableCell>
                    <TableCell>{fmtMs(s.avgMs)}</TableCell><TableCell>{fmtMs(s.maxMs)}</TableCell><TableCell>{s.avgAttempts.toFixed(1)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          <Typography variant="subtitle2">Recent runs</Typography>
          <Card variant="outlined">
            <Table size="small">
              <TableHead><TableRow><TableCell>Started</TableCell><TableCell>Status</TableCell><TableCell>Duration</TableCell><TableCell>Steps</TableCell><TableCell>Error</TableCell></TableRow></TableHead>
              <TableBody>
                {report.recent.map((r) => (
                  <TableRow key={r.runId} hover sx={{ cursor: 'pointer' }} onClick={() => setDetail(r.runId)}>
                    <TableCell>{fmtTime(r.startedAt)}</TableCell><TableCell><RunChip status={r.status} /></TableCell><TableCell>{fmtMs(r.durationMs)}</TableCell>
                    <TableCell>{r.passedSteps}/{r.totalSteps}</TableCell><TableCell sx={{ maxWidth: 420, wordBreak: 'break-word' }}><Typography variant="caption" color="error">{r.error ?? ''}</Typography></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
      {detail && <RunDetailDialog runId={detail} onClose={() => setDetail(null)} />}
    </Stack>
  );
}
