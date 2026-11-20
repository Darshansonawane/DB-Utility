import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Card, Chip, Dialog, DialogContent, DialogTitle, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import StatusChip from '../components/StatusChip';

type Row = Record<string, unknown>;
const g = (r: Row, k: string) => r[k.toUpperCase()] ?? r[k];
const t = (v: unknown) => (v ? String(v).replace('T', ' ').slice(0, 19) : '');

export default function History() {
  const [tab, setTab] = useState(0);
  const [runs, setRuns] = useState<Row[]>([]);
  const [execs, setExecs] = useState<Row[]>([]);
  const [audit, setAudit] = useState<Row[]>([]);
  const [customer, setCustomer] = useState('');
  const [status, setStatus] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const { error, run } = useAsync();

  const load = useCallback(async () => {
    await run(async () => {
      if (tab === 0) setRuns(await api.workflowRuns(customer || undefined));
      if (tab === 1) setExecs(await api.executions(status || undefined));
      if (tab === 2) setAudit(await api.audit());
    });
  }, [run, tab, customer, status]);
  useEffect(() => { const h = setTimeout(() => void load(), 250); return () => clearTimeout(h); }, [load]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Execution History</Typography>
      <Alert severity="info">Identifiers are masked (first and last two characters). Row data is never stored in history. Search by customer ID matches the masked form.</Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}><Tab label="Workflow runs" /><Tab label="Query executions" /><Tab label="Audit log" /></Tabs>
      {tab === 0 && (
        <>
          <TextField size="small" label="Filter by Customer ID" value={customer} onChange={(e) => setCustomer(e.target.value)} sx={{ maxWidth: 300 }} />
          <Card><Table size="small">
            <TableHead><TableRow><TableCell>Started</TableCell><TableCell>Workflow</TableCell><TableCell>Customer</TableCell><TableCell>Contributor</TableCell><TableCell>Client unique</TableCell><TableCell>Payment master</TableCell><TableCell>Env</TableCell><TableCell>Status</TableCell><TableCell>ms</TableCell><TableCell>Failed steps</TableCell></TableRow></TableHead>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={String(g(r, 'id'))} hover sx={{ cursor: 'pointer' }} onClick={async () => setDetail(await api.workflowRun(String(g(r, 'id'))))}>
                  <TableCell>{t(g(r, 'started_at'))}</TableCell><TableCell>{String(g(r, 'workflow_name'))}</TableCell>
                  <TableCell>{String(g(r, 'customer_id_masked') ?? '')}</TableCell><TableCell>{String(g(r, 'contributor_id_masked') ?? '')}</TableCell>
                  <TableCell>{String(g(r, 'client_unique_id_masked') ?? '')}</TableCell><TableCell>{String(g(r, 'payment_master_id_masked') ?? '')}</TableCell>
                  <TableCell>{String(g(r, 'environment') ?? '')}</TableCell><TableCell><StatusChip status={String(g(r, 'status'))} /></TableCell>
                  <TableCell>{String(g(r, 'duration_ms') ?? '')}</TableCell><TableCell>{String(g(r, 'failed_steps') ?? '')}</TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && <TableRow><TableCell colSpan={10}><Typography color="text.secondary">No workflow runs recorded.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table></Card>
        </>
      )}
      {tab === 1 && (
        <>
          <TextField size="small" select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ maxWidth: 200 }}>
            <MenuItem value="">All</MenuItem><MenuItem value="SUCCESS">SUCCESS</MenuItem><MenuItem value="FAILED">FAILED</MenuItem>
          </TextField>
          <Card><Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Kind</TableCell><TableCell>Query</TableCell><TableCell>SQL</TableCell><TableCell>Parameters (masked)</TableCell><TableCell>Rows</TableCell><TableCell>Affected</TableCell><TableCell>ms</TableCell><TableCell>Status</TableCell><TableCell>Error</TableCell></TableRow></TableHead>
            <TableBody>
              {execs.map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{t(g(e, 'executed_at'))}</TableCell><TableCell>{String(g(e, 'kind'))}</TableCell><TableCell>{String(g(e, 'query_name') ?? '')}</TableCell>
                  <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }} title={String(g(e, 'sql_text') ?? '')}>{String(g(e, 'sql_text') ?? '')}</TableCell>
                  <TableCell>{String(g(e, 'params_masked') ?? '')}</TableCell><TableCell>{String(g(e, 'rows_returned') ?? '')}</TableCell><TableCell>{String(g(e, 'rows_affected') ?? '')}</TableCell>
                  <TableCell>{String(g(e, 'duration_ms') ?? '')}</TableCell><TableCell><StatusChip status={String(g(e, 'status'))} /></TableCell><TableCell>{String(g(e, 'error_message') ?? '')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table></Card>
        </>
      )}
      {tab === 2 && (
        <Card><Table size="small">
          <TableHead><TableRow><TableCell>When</TableCell><TableCell>Action</TableCell><TableCell>User</TableCell><TableCell>Connection</TableCell><TableCell>SQL</TableCell><TableCell>Params (masked)</TableCell><TableCell>Rows affected</TableCell><TableCell>Status</TableCell><TableCell>Detail</TableCell></TableRow></TableHead>
          <TableBody>
            {audit.map((a, i) => (
              <TableRow key={i}>
                <TableCell>{t(g(a, 'occurred_at'))}</TableCell><TableCell>{String(g(a, 'action'))}</TableCell><TableCell>{String(g(a, 'actor') ?? '')}</TableCell>
                <TableCell>{String(g(a, 'connection_name') ?? '')} {g(a, 'environment') ? <Chip size="small" label={String(g(a, 'environment'))} /> : null}</TableCell>
                <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }} title={String(g(a, 'sql_text') ?? '')}>{String(g(a, 'sql_text') ?? '')}</TableCell>
                <TableCell>{String(g(a, 'params_masked') ?? '')}</TableCell><TableCell>{String(g(a, 'rows_affected') ?? '')}</TableCell>
                <TableCell>{g(a, 'status') ? <StatusChip status={String(g(a, 'status'))} /> : null}</TableCell><TableCell>{String(g(a, 'detail') ?? '')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></Card>
      )}
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="lg" fullWidth>
        <DialogTitle>Workflow run detail</DialogTitle>
        <DialogContent dividers>
          {detail && (
            <Stack spacing={2}>
              <Box>
                <Typography><b>{String(g(detail, 'workflow_name'))}</b> · {t(g(detail, 'started_at'))} · {String(g(detail, 'duration_ms'))} ms · <StatusChip status={String(g(detail, 'status'))} /></Typography>
                <Typography variant="body2">Connection: {String(g(detail, 'connection_name'))} ({String(g(detail, 'environment'))}) · Inputs: {String(g(detail, 'inputs_masked') ?? '')}</Typography>
                <Typography variant="body2">Operations: {String(g(detail, 'operations') ?? '')} · Rows affected: {String(g(detail, 'rows_affected') ?? 0)}</Typography>
                {g(detail, 'error_message') ? <Alert severity="error" sx={{ mt: 1 }}>{String(g(detail, 'error_message'))}</Alert> : null}
              </Box>
              <Table size="small">
                <TableHead><TableRow><TableCell>#</TableCell><TableCell>Step</TableCell><TableCell>Status</TableCell><TableCell>ms</TableCell><TableCell>Attempts</TableCell><TableCell>Rows</TableCell><TableCell>Inputs (masked)</TableCell><TableCell>Error</TableCell></TableRow></TableHead>
                <TableBody>
                  {((detail.steps as Row[]) ?? []).map((s, i) => (
                    <TableRow key={i}>
                      <TableCell>{String(g(s, 'step_order'))}</TableCell><TableCell>{String(g(s, 'step_name'))}</TableCell><TableCell><StatusChip status={String(g(s, 'status'))} /></TableCell>
                      <TableCell>{String(g(s, 'duration_ms') ?? '')}</TableCell><TableCell>{String(g(s, 'attempts') ?? '')}</TableCell><TableCell>{String(g(s, 'rows_returned') ?? '')}</TableCell>
                      <TableCell>{String(g(s, 'inputs_masked') ?? '')}</TableCell><TableCell>{String(g(s, 'error_message') ?? '')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
