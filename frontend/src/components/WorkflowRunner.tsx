import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { ParamType, RunForm, RunFormParam, RunView, StepRunView, Workflow } from '../types';
import { useNotify } from './Notifier';
import { ms } from '../utils/format';
import DynamicForm from './DynamicForm';
import ResultTable from './ResultTable';
import StatusChip from './StatusChip';
import PipelineBar from './motion/PipelineBar';
import FlowConnector, { flowStateOf } from './motion/FlowConnector';

type Overrides = Record<number, Record<string, string>>;

interface Props { workflow: Workflow; onRunChange?: (run: RunView | null) => void }

/**
 * Generic runner for any workflow: initial inputs -> run all / run one step / resume -> one expandable card per step
 * showing status, timing, resolved inputs (editable override), outputs and errors.
 */
const defaultsOf = (w: Workflow): Record<string, string> =>
  Object.fromEntries(w.inputs.filter((i) => (i.defaultValue ?? '').trim() !== '').map((i) => [i.name, (i.defaultValue ?? '').trim()]));

export default function WorkflowRunner({ workflow, onRunChange }: Props) {
  const notify = useNotify();
  const [form, setForm] = useState<RunForm | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>(() => defaultsOf(workflow));
  const [overrides, setOverrides] = useState<Overrides>({});
  const [run, setRun] = useState<RunView | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const { loading, error, setError, run: act } = useAsync();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { onRunChange?.(run); }, [run, onRunChange]);
  // where every step value comes from (automatic / workflow input / constant / default), for the optional runtime form
  useEffect(() => {
    let off = false;
    if (workflow.id != null) Promise.resolve(api.workflowRunForm(workflow.id)).then((f) => { if (!off && f) setForm(f); }).catch(() => undefined);
    return () => { off = true; };
  }, [workflow.id]);

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

  // an input with a default is never "missing"; a required one with nothing behind it only blocks the steps that need it
  const inputParams = workflow.inputs.map((i) => ({ name: i.name, label: i.label, type: i.type, required: i.required && !(i.defaultValue ?? '').trim() }));
  const inputHints = Object.fromEntries(workflow.inputs.filter((i) => (i.defaultValue ?? '').trim()).map((i) => [i.name, `Default: ${i.defaultValue}. Clear the field to use it.`]));
  const missingInputs = workflow.inputs.filter((i) => i.required && !(i.defaultValue ?? '').trim() && !(inputs[i.name] ?? '').trim());
  const typedInputs = Object.fromEntries(Object.entries(inputs).filter(([, v]) => (v ?? '').trim() !== ''));
  const running = run?.status === 'RUNNING';

  const apply = (r: RunView | undefined) => {
    if (!r) return;
    setRun(r);
    setExpanded((e) => ({ ...e, ...Object.fromEntries(r.steps.map((s) => [s.order, true])) }));
    if (r.status === 'RUNNING') poll(r.runId);
  };

  const sameInputs = (r: RunView) => workflow.inputs.every((i) => (r.inputs[i.name] ?? '') === (inputs[i.name] ?? '').trim());

  const fetchAll = async () => {
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
  const reset = () => { clearResults(); setInputs(defaultsOf(workflow)); setOverrides({}); setExpanded({}); };
  // run-time values are for this run only; they become the workflow's defaults only when saved explicitly
  const saveDefaults = async () => {
    const ok = await act(() => api.saveInputDefaults(workflow.id!, typedInputs));
    if (ok !== undefined) notify.success('Saved as the default values for this workflow');
  };

  const setOverride = (order: number, param: string, v: string) =>
    setOverrides((o) => ({ ...o, [order]: { ...(o[order] ?? {}), [param]: v } }));

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" fontWeight={700} gutterBottom>Runtime inputs <Typography component="span" variant="caption" color="text.secondary">(optional)</Typography></Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Everything here is optional. Values flow automatically from earlier steps; type a value only to override one for this run. Overrides apply to this run only unless you save them.
        </Typography>
        {workflow.inputs.length > 0 && (
          <Box sx={{ maxWidth: 480 }}>
            <DynamicForm parameters={inputParams} values={inputs} onChange={setInputs} disabled={running} hints={inputHints} />
          </Box>
        )}
        {missingInputs.length > 0 && (
          <Alert severity="info" sx={{ mt: 1.5 }}>
            No value for required input{missingInputs.length > 1 ? 's' : ''}: {missingInputs.map((i) => i.label).join(', ')}. The workflow still runs; only the steps that need {missingInputs.length > 1 ? 'them' : 'it'} are blocked.
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap" useFlexGap>
          <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={fetchAll} disabled={loading || running}>Run workflow</Button>
          {workflow.inputs.length > 0 && (
            <Tooltip title="Make the values typed above the defaults for future runs"><span>
              <Button variant="outlined" onClick={saveDefaults} disabled={loading || running || Object.keys(typedInputs).length === 0}>Save as defaults</Button>
            </span></Tooltip>
          )}
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

      {run && <PipelineBar steps={workflow.steps.map((s) => ({ order: s.order, name: s.name, status: run.steps.find((x) => x.order === s.order)?.status ?? 'PENDING' }))} />}

      {workflow.steps.map((s, idx) => {
        const sv: StepRunView = run?.steps.find((x) => x.order === s.order) ?? {
          order: s.order, name: s.name, status: 'PENDING', attempts: 0, params: {}, paramSources: {}, outputs: {},
        } as StepRunView;
        return (
          <Box key={s.order}>
          {idx > 0 && <FlowConnector state={flowStateOf(run?.steps.find((x) => x.order === workflow.steps[idx - 1].order)?.status)} />}
          <Accordion expanded={!!expanded[s.order]} onChange={(_, v) => setExpanded((e) => ({ ...e, [s.order]: v }))} disableGutters variant="outlined">
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
                <StepParams step={sv} workflowStep={s} info={form?.steps.find((x) => x.order === s.order)?.params ?? []} inputs={inputs} overrides={overrides[s.order] ?? {}} onOverride={(p, v) => setOverride(s.order, p, v)} disabled={running} />
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
          </Box>
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

const TYPE_LABEL: Record<ParamType, string> = { STRING: 'text', INTEGER: 'number', DECIMAL: 'decimal', DATE: 'date', DATETIME: 'date & time', BOOLEAN: 'yes / no' };

/** One override field, typed: text, number, date, date & time or yes/no. Empty means "use the automatic value". */
function OverrideField({ type, value, onChange, placeholder, disabled, testId, label }: {
  type: ParamType; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean; testId: string; label: string;
}) {
  const common = { size: 'small' as const, fullWidth: true, disabled, value, placeholder, inputProps: { 'aria-label': label, 'data-testid': testId, 'data-type': type } };
  if (type === 'BOOLEAN') {
    return (
      <TextField {...common} select SelectProps={{ displayEmpty: true, renderValue: (v) => (v ? String(v) : <span style={{ opacity: 0.6 }}>{placeholder}</span>) }} onChange={(e) => onChange(e.target.value)}>
        <MenuItem value=""><em>{placeholder}</em></MenuItem><MenuItem value="true">Yes (true)</MenuItem><MenuItem value="false">No (false)</MenuItem>
      </TextField>
    );
  }
  const hasVar = value.includes('{{');
  const htmlType = hasVar ? 'text' : type === 'DATE' ? 'date' : type === 'DATETIME' ? 'datetime-local' : 'text';
  return (
    <TextField {...common} type={htmlType} InputLabelProps={{ shrink: true }} onChange={(e) => onChange(e.target.value)}
      inputProps={{ ...common.inputProps, ...(type === 'INTEGER' && !hasVar ? { inputMode: 'numeric' as const } : type === 'DECIMAL' && !hasVar ? { inputMode: 'decimal' as const } : {}) }} />
  );
}

function sourceOf(name: string, p: RunFormParam | undefined, step: StepRunView, overridden: boolean, inputs: Record<string, string>): { text: string; placeholder: string; color: 'primary' | 'success' | 'default' | 'warning' } {
  if (overridden) return { text: 'Runtime override (this run only)', placeholder: '', color: 'primary' };
  const ran = step.paramSources?.[name];
  if (ran) return { text: ran, placeholder: 'automatic', color: ran.startsWith('Default') ? 'default' : 'success' };
  if (!p) return { text: 'resolved when run', placeholder: 'automatic', color: 'default' };
  switch (p.sourceKind) {
    case 'AUTOMATIC': return { text: `Automatic · ${p.source}`, placeholder: 'automatic', color: 'success' };
    case 'WORKFLOW_INPUT': return { text: p.source, placeholder: (p.inputRef && inputs[p.inputRef]) || 'from the workflow input', color: 'success' };
    case 'CONSTANT': return { text: 'Constant', placeholder: p.constant ?? '', color: 'default' };
    case 'DEFAULT': return { text: 'Default value', placeholder: p.defaultValue ?? '', color: 'default' };
    default: return p.required ? { text: 'Required: nothing provides it yet', placeholder: 'required', color: 'warning' } : { text: 'Optional: left empty', placeholder: 'empty', color: 'default' };
  }
}

function StepParams({ step, workflowStep, info, inputs, overrides, onOverride, disabled }: {
  step: StepRunView; workflowStep: Workflow['steps'][number]; info: RunFormParam[]; inputs: Record<string, string>; overrides: Record<string, string>;
  onOverride: (param: string, v: string) => void; disabled?: boolean;
}) {
  const byName = new Map(info.map((p) => [p.name, p]));
  const names = Array.from(new Set([...info.map((p) => p.name), ...workflowStep.mappings.map((m) => m.paramName), ...Object.keys(step.params ?? {})]));
  if (names.length === 0) return null;
  return (
    <Table size="small" sx={{ maxWidth: 860 }}>
      <TableHead><TableRow><TableCell>Input parameter</TableCell><TableCell>Value (type to override, leave empty for automatic)</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
      <TableBody>
        {names.map((p) => {
          const meta = byName.get(p);
          const overridden = (overrides[p] ?? '') !== '';
          const src = sourceOf(p, meta, step, overridden, inputs);
          return (
            <TableRow key={p}>
              <TableCell sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                {p}{meta?.required ? <Typography component="span" color="error.main"> *</Typography> : null}
                {meta && <Typography component="div" variant="caption" color="text.secondary">{TYPE_LABEL[meta.type]}{meta.required ? ', required' : ', optional'}</Typography>}
              </TableCell>
              <TableCell>
                <OverrideField type={meta?.type ?? 'STRING'} disabled={disabled} value={overrides[p] ?? step.params?.[p] ?? ''} placeholder={src.placeholder || 'automatic'}
                  onChange={(v) => onOverride(p, v)} testId={`override-${step.order}-${p}`} label={`step ${step.order} ${p}`} />
              </TableCell>
              <TableCell><Chip size="small" variant="outlined" color={src.color} label={src.text} sx={{ maxWidth: 280 }} /></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
