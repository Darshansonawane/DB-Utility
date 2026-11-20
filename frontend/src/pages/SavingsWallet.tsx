import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Stack, Tab, Tabs, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { RunView, Workflow } from '../types';
import { rowsToObjects } from '../utils/format';
import DateManagerPanel, { type ExistingDateOption } from '../components/DateManagerPanel';
import SchemaInspector from '../components/SchemaInspector';
import WorkflowRunner from '../components/WorkflowRunner';

const WORKFLOW_NAME = 'Savings Wallet - Schedule & Payment Data Manager';
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export default function SavingsWallet() {
  const [tab, setTab] = useState(0);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [scheduleColumn, setScheduleColumn] = useState('');
  const original = useRef<{ runId: string; value: string; label: string } | null>(null);
  const { error, run: act } = useAsync();

  useEffect(() => { void act(async () => setWorkflow((await api.workflows()).find((w) => w.name === WORKFLOW_NAME) ?? null)); }, [act]);
  const onRunChange = useCallback((r: RunView | null) => setRun(r), []);

  const step1 = run?.steps.find((s) => s.order === 1);
  const step1Row = step1?.result && step1.result.rows.length ? rowsToObjects(step1.result.columns, step1.result.rows)[0] : null;
  const scheduleDateColumns = useMemo(
    () => (step1?.result?.columns ?? []).map((c) => c.name).filter((n) => step1Row && DATE_RE.test(String(step1Row[n] ?? ''))),
    [step1, step1Row]);

  // The original scheduled date is captured once per run from Step 1 and never overwritten afterwards.
  if (run && step1Row && scheduleColumn && step1Row[scheduleColumn] && original.current?.runId !== run.runId) {
    original.current = { runId: run.runId, value: String(step1Row[scheduleColumn]).slice(0, 10), label: `Step 1 · ${scheduleColumn} (latest schedule row)` };
  }
  const captured = run && original.current?.runId === run.runId ? original.current : null;

  const existing: ExistingDateOption[] = useMemo(() => {
    const out: ExistingDateOption[] = [];
    (run?.steps ?? []).forEach((s) => {
      if (!s.result || s.result.rows.length === 0) return;
      const row = rowsToObjects(s.result.columns, s.result.rows)[0];
      Object.entries(row).forEach(([k, v]) => { if (/date/i.test(k) && v) out.push({ label: `Step ${s.order} · ${k}`, value: String(v).slice(0, 10) }); });
    });
    return out;
  }, [run]);

  return (
    <Stack spacing={2}>
      <Typography variant="h5">Savings Wallet – Schedule &amp; Payment Data Manager</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!workflow && !error && <Alert severity="warning">Workflow "{WORKFLOW_NAME}" was not found. It is created automatically on first start.</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Fetch details" /><Tab label="Date management" /><Tab label="Schema inspector" />
      </Tabs>
      {tab === 0 && workflow && (
        <>
          <Alert severity="info">
            All seven steps are read-only SELECTs. Step 1 returns every schedule row for the customer (no one-month-back filter yet: that
            needs your confirmation of the real date column). Client Unique ID and Payment Master ID are passed on automatically; edit any value to override it.
          </Alert>
          <WorkflowRunner workflow={workflow} onRunChange={onRunChange} />
        </>
      )}
      {tab === 1 && (
        <>
          {scheduleDateColumns.length > 0 && !captured && (
            <Alert severity="warning" action={
              <select aria-label="schedule date column" value={scheduleColumn} onChange={(e) => setScheduleColumn(e.target.value)}>
                <option value="">choose column…</option>
                {scheduleDateColumns.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>}>
              Which Step 1 column holds the scheduled date? It is not assumed. Choose it to capture the original scheduled date for this run.
            </Alert>
          )}
          {captured && <Alert severity="success">Original scheduled date captured from {captured.label}: <b>{captured.value}</b> (kept for this run).</Alert>}
          <DateManagerPanel existing={existing} originalScheduledDate={captured?.value ?? null} originalLabel={captured?.label} />
        </>
      )}
      {tab === 2 && <SchemaInspector defaultSchemas={['bank_wallet', 'BankInstruction']} />}
    </Stack>
  );
}
