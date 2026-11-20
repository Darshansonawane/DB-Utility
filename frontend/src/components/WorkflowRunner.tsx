import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { RunView, StepRunView, Workflow } from '../types';
import { ms } from '../utils/format';
import DynamicForm from './DynamicForm';
import ResultTable from './ResultTable';
import StatusChip from './StatusChip';

type Overrides = Record<number, Record<string, string>>;

interface Props { workflow: Workflow; onRunChange?: (run: RunView | null) => void }

/**
 * Generic runner for any workflow: initial inputs -> run all / run one step / resume -> one expandable card per step
 * showing status, timing, resolved inputs (editable override), outputs and errors.
 */
export default function WorkflowRunner({ workflow, onRunChange }: Props) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  const [run, setRun] = useState<RunView | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const { loading, error, setError, run: act } = useAsync();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { onRunChange?.(run); }, [run, onRunChange]);

  const stopPolling = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  const poll = useCallback((runId: string) => {
    stopPolling();
    timer.current = setInterval(async () => {
      try {
        const r = await api.getRun(runId);
        setRun(r);
        if (r.status !== 'RUNNING') stopPolling();
      } catch (e) {
        stopPolling();
        setError(e instanceof Error ? e.message : 'Lost contact with the backend');
      }
    }, 500);
  }, [setError]);
  useEffect(() => stopPolling, []);

  const inputParams = workflow.inputs.map((i) => ({ name: i.name, label: i.label, type: i.type, required: i.required }));
  const missingInputs = workflow.inputs.filter((i) => i.required && !(inputs[i.name] ?? '').trim());
  const running = run?.status === 'RUNNING';

  const apply = (r: RunView | undefined) => {
    if (!r) return;
    setRun(r);
    setExpanded((e) => ({ ...e, ...Object.fromEntries(r.steps.map((s) => [s.order, true])) }));
    if (r.status === 'RUNNING') poll(r.runId);
  };

  const sameInputs = (r: RunView) => workflow.inputs.every((i) => (r.inputs[i.name] ?? '') === (inputs[i.name] ?? '').trim());

  const fetchAll = async () => {
    if (missingInputs.length) return setError(`Required: ${missingInputs.map((i) => i.label).join(', ')}`);
    setRun(null);
    apply(await act(() => api.startRun(workflow.id!, inputs, overrides, [])));
  };

  const runStep = async (order: number) => {
    const ov = { [order]: overrides[order] ?? {} };
    if (run && !running && sameInputs(run)) apply(await act(() => api.executeOnRun(run.runId, [order], ov)));
    else apply(await act(() => api.startRun(workflow.id!, inputs, ov, [order])));
  };

  const resume = async () => {
    if (!run) return;
    apply(await act(() => api.executeOnRun(run.runId, [], overrides)));
  };

  const stop = async () => { if (run) apply(await act(() => api.stopRun(run.runId))); };

  const clearResults = () => { stopPolling(); setRun(null); setError(null); };
  const reset = () => { clearResults(); setInputs({}); setOverrides({}); setExpanded({}); };

  const setOverride = (order: number, param: string, v: string) =>
    setOverrides((o) => ({ ...o, [order]: { ...(o[order] ?? {}), [param]: v } }));

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>Initial inputs</Typography>
        <Box sx={{ maxWidth: 480 }}>
          <DynamicForm parameters={inputParams} values={inputs} onChange={setInputs} disabled={running} />
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={fetchAll} disabled={loading || running}>Fetch All Details</Button>
          <Button variant="outlined" onClick={resume} disabled={!run || loading || running}>Resume pending / failed steps</Button>
          {running && <Button color="warning" variant="outlined" startIcon={<StopIcon />} onClick={stop}>Stop after current step</Button>}
          <Button onClick={clearResults} disabled={running}>Clear</Button>
          <Button onClick={reset} disabled={running}>Reset</Button>
        </Stack>
      </Paper>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {run && (
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">Run {run.runId.slice(0, 8)}</Typography>
          <StatusChip status={run.status} />
          <Chip size="small" label={ms(run.durationMs)} />
          <Typography variant="caption" color="text.secondary">Values and rows are kept in memory for this session only; history stores masked identifiers.</Typography>
        </Stack>
      )}

      {workflow.steps.map((s) => {
        const sv: StepRunView = run?.steps.find((x) => x.order === s.order) ?? {
          order: s.order, name: s.name, status: 'PENDING', attempts: 0, params: {}, paramSources: {}, outputs: {},
        } as StepRunView;
        return (
          <Accordion key={s.order} expanded={!!expanded[s.order]} onChange={(_, v) => setExpanded((e) => ({ ...e, [s.order]: v }))} disableGutters variant="outlined">
            <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label={`step ${s.order}`}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                <Typography fontWeight={700} sx={{ minWidth: 70 }}>Step {s.order}</Typography>
                <Typography sx={{ flex: 1 }}>{s.name}</Typography>
                <StatusChip status={sv.status} />
                <Typography variant="caption" sx={{ minWidth: 60, textAlign: 'right' }}>{sv.status === 'PENDING' ? '' : ms(sv.durationMs)}</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">{sv.queryName ?? s.queryName}{s.description ? ` - ${s.description}` : ''}</Typography>
                <StepParams step={sv} workflowStep={s} overrides={overrides[s.order] ?? {}} onOverride={(p, v) => setOverride(s.order, p, v)} disabled={running} queryId={s.queryId} />
                <Box><Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => runStep(s.order)} disabled={loading || running}>Run this step</Button></Box>
                {sv.status === 'NO_DATA' && <Alert severity="warning">No records found for the given input(s).</Alert>}
                {sv.status === 'BLOCKED' && <Alert severity="warning">Not executed. {sv.error}</Alert>}
                {sv.status === 'FAILED' && <Alert severity="error">{sv.error}{sv.attempts > 1 ? ` (after ${sv.attempts} attempts)` : ''}</Alert>}
                {(sv.status === 'SKIPPED' || sv.status === 'STOPPED') && <Alert severity="info">{sv.message}</Alert>}
                {sv.status === 'SUCCESS' && sv.message && <Alert severity="info">{sv.message}</Alert>}
                {Object.keys(sv.outputs ?? {}).length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {Object.entries(sv.outputs).map(([k, v]) => <Chip key={k} color="primary" variant="outlined" label={`${k}: ${String(v)}`} />)}
                  </Stack>
                )}
                {sv.children && sv.children.length > 0 ? <ChildSteps steps={sv.children} depth={1} /> : sv.result && sv.result.columns.length > 0 && <ResultTable columns={sv.result.columns} rows={sv.result.rows} truncated={sv.result.truncated} />}
              </Stack>
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Stack>
  );
}

/** Steps of a nested (micro) workflow, shown under the step that ran it. */
function ChildSteps({ steps, depth }: { steps: StepRunView[]; depth: number }) {
  return (
    <Box sx={{ borderLeft: 3, borderColor: 'secondary.main', pl: 1.5 }}>
      <Typography variant="subtitle2" gutterBottom>Steps of the nested workflow</Typography>
      <Stack spacing={1}>
        {steps.map((c) => (
          <Accordion key={c.order} disableGutters variant="outlined" TransitionProps={{ unmountOnExit: true }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-label={`nested step ${c.order}`}>
              <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                <Typography fontWeight={700} sx={{ minWidth: 60 }}>{depth}.{c.order}</Typography>
                <Typography sx={{ flex: 1 }}>{c.name}</Typography>
                <StatusChip status={c.status} />
                <Typography variant="caption" sx={{ minWidth: 60, textAlign: 'right' }}>{c.status === 'PENDING' ? '' : ms(c.durationMs)}</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">{c.queryName}</Typography>
                {c.error && <Alert severity={c.status === 'BLOCKED' ? 'warning' : 'error'}>{c.error}</Alert>}
                {c.message && <Alert severity="info">{c.message}</Alert>}
                {Object.keys(c.outputs ?? {}).length > 0 && (
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {Object.entries(c.outputs).map(([k, v]) => <Chip key={k} color="primary" variant="outlined" label={`${k}: ${String(v)}`} />)}
                  </Stack>
                )}
                {c.children && c.children.length > 0 ? <ChildSteps steps={c.children} depth={depth + 1} />
                  : c.result && c.result.columns.length > 0 && <ResultTable columns={c.result.columns} rows={c.result.rows} truncated={c.result.truncated} />}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>
    </Box>
  );
}

function StepParams({ step, workflowStep, overrides, onOverride, disabled }: {
  step: StepRunView; workflowStep: Workflow['steps'][number]; overrides: Record<string, string>;
  onOverride: (param: string, v: string) => void; disabled?: boolean; queryId: number;
}) {
  const names = Array.from(new Set([...workflowStep.mappings.map((m) => m.paramName), ...Object.keys(step.params ?? {})]));
  if (names.length === 0) return null;
  return (
    <Table size="small" sx={{ maxWidth: 760 }}>
      <TableHead><TableRow><TableCell>Input parameter</TableCell><TableCell>Value (edit to override)</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
      <TableBody>
        {names.map((p) => (
          <TableRow key={p}>
            <TableCell sx={{ fontFamily: 'monospace' }}>{p}</TableCell>
            <TableCell>
              <TextField size="small" fullWidth disabled={disabled} value={overrides[p] ?? step.params?.[p] ?? ''} placeholder="automatic"
                onChange={(e) => onOverride(p, e.target.value)} inputProps={{ 'aria-label': `step ${step.order} ${p}`, 'data-testid': `override-${step.order}-${p}` }} />
            </TableCell>
            <TableCell><Typography variant="caption">{overrides[p] ? 'Manual override (applies on next run)' : step.paramSources?.[p] ?? 'resolved when run'}</Typography></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
