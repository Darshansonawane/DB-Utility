import { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Button, ToggleButton, ToggleButtonGroup, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper,
  Box, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ApiStepOptionsEditor, { DEFAULT_OPTIONS } from './ApiStepOptionsEditor';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { FolderSelect } from './folders/FolderPicker';
import StepTargetPicker, { type TargetItem } from './workflow/StepTargetPicker';
import StepTestRun from './workflow/StepTestRun';
import { folderPaths } from './folders/folderUtils';
import type { ApiRequestDef, Folder, ParamMapping, ParamType, Project, SavedQuery, SourceType, Workflow, WorkflowStep } from '../types';

const EMPTY: Workflow = { name: '', description: '', inputs: [], steps: [] };
const TYPES: ParamType[] = ['STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN'];

interface Props {
  open: boolean; initial?: Workflow | null; folders: Folder[]; projects?: Project[]; defaultProjectId?: number; defaultFolderId?: number;
  allWorkflows: Workflow[]; onClose: () => void; onSaved: () => void;
}

/** Does workflow `wf` (directly or through other workflows) contain a step running workflow `targetId`? */
function contains(wf: Workflow, targetId: number, all: Workflow[], seen = new Set<number>()): boolean {
  return wf.steps.some((st) => {
    if (st.stepType !== 'WORKFLOW' || st.subWorkflowId == null) return false;
    if (st.subWorkflowId === targetId) return true;
    if (seen.has(st.subWorkflowId)) return false;
    seen.add(st.subWorkflowId);
    const sub = all.find((x) => x.id === st.subWorkflowId);
    return sub ? contains(sub, targetId, all, seen) : false;
  });
}

export default function WorkflowEditDialog({ open, initial, folders, projects = [], defaultProjectId, defaultFolderId, allWorkflows, onClose, onSaved }: Props) {
  const [w, setW] = useState<Workflow>(EMPTY);
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [apiRequests, setApiRequests] = useState<ApiRequestDef[]>([]);
  const { loading, error, setError, run } = useAsync();

  useEffect(() => {
    if (!open) return;
    setW(initial ? structuredClone(initial) : { ...EMPTY, folderId: defaultFolderId ?? 0, projectId: defaultProjectId ?? projects[0]?.id ?? null });
    setError(null);
    void run(async () => { setQueries(await api.queries()); setApiRequests(await api.apiRequests()); });
  }, [open, initial, run, setError]);

  const updStep = (i: number, patch: Partial<WorkflowStep>) => setW((cur) => ({ ...cur, steps: cur.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const queryOf = (id: number) => queries.find((q) => q.id === id);
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const pickable = allWorkflows.filter((x) => x.id !== w.id && !(w.id != null && contains(x, w.id, allWorkflows)));

  const addStep = (kind: 'QUERY' | 'API_REQUEST' | 'WORKFLOW') => setW((cur) => ({
    ...cur,
    steps: [...cur.steps, {
      order: (cur.steps.at(-1)?.order ?? 0) + 1, name: '', queryId: 0, dependsOn: [], retryCount: 0, retryDelayMs: 500, stopOnFailure: false, outputFields: [], mappings: [],
      stepType: kind, apiRequestId: null, apiOptions: kind === 'API_REQUEST' ? { ...DEFAULT_OPTIONS } : null, subWorkflowId: null,
    }],
  }));

  const switchType = (i: number, t: 'QUERY' | 'API_REQUEST' | 'WORKFLOW') => updStep(i, t === 'API_REQUEST'
    ? { stepType: t, queryId: 0, mappings: [], subWorkflowId: null, apiOptions: w.steps[i].apiOptions ?? { ...DEFAULT_OPTIONS } }
    : t === 'WORKFLOW'
      ? { stepType: t, queryId: 0, mappings: [], apiRequestId: null, apiOptions: null, outputFields: [], subWorkflowId: null }
      : { stepType: t, apiRequestId: null, apiOptions: null, subWorkflowId: null, mappings: [] });

  /** Auto-wire a parameter to a workflow input of the same name; anything else is simply supplied at runtime (no mapping needed). */
  const wireSameName = (names: string[]): ParamMapping[] => names
    .filter((n) => w.inputs.some((x) => x.name === n))
    .map((n): ParamMapping => ({ paramName: n, sourceType: 'INPUT', sourceRef: n }));

  /** Everything a step can run, in one searchable list. Workflows that would create a loop are left out. */
  const targetItems = useMemo<TargetItem[]>(() => [
    ...queries.map((q): TargetItem => ({ type: 'QUERY', id: q.id!, name: q.name, description: q.description, meta: [q.category, q.engine === 'MONGODB' ? 'MongoDB' : 'MySQL', q.queryType].filter(Boolean).join(' ') })),
    ...apiRequests.map((r): TargetItem => ({ type: 'API_REQUEST', id: r.id!, name: r.name, description: r.description, meta: `${r.method} ${r.url}` })),
    ...pickable.map((x): TargetItem => ({ type: 'WORKFLOW', id: x.id!, name: x.name, description: x.description, meta: x.folderId ? paths.get(x.folderId) : null })),
  ], [queries, apiRequests, pickable, paths]);

  /** Choose the target of step i. An item of another type switches the step's type in the same update, so a step never mixes types. */
  const pickTarget = (i: number, item: TargetItem | null, currentType: 'QUERY' | 'API_REQUEST' | 'WORKFLOW') => {
    const s = w.steps[i];
    if (!item) {
      updStep(i, currentType === 'API_REQUEST' ? { apiRequestId: null, apiRequestName: undefined, mappings: [] }
        : currentType === 'WORKFLOW' ? { subWorkflowId: null, subWorkflowName: undefined, mappings: [] } : { queryId: 0, queryName: undefined, mappings: [] });
      return;
    }
    if (item.type === 'API_REQUEST') {
      updStep(i, { stepType: 'API_REQUEST', queryId: 0, subWorkflowId: null, subWorkflowName: undefined, apiRequestId: item.id, apiRequestName: item.name, name: s.name || item.name, mappings: [],
        apiOptions: s.apiOptions ?? { ...DEFAULT_OPTIONS } });
    } else if (item.type === 'WORKFLOW') {
      const sub = allWorkflows.find((x) => x.id === item.id) ?? null;
      updStep(i, { stepType: 'WORKFLOW', queryId: 0, apiRequestId: null, apiRequestName: undefined, apiOptions: null, outputFields: [], subWorkflowId: item.id, subWorkflowName: item.name,
        name: s.name || item.name, mappings: wireSameName((sub?.inputs ?? []).map((inp) => inp.name)) });
    } else {
      const q = queryOf(item.id);
      updStep(i, { stepType: 'QUERY', apiRequestId: null, apiRequestName: undefined, apiOptions: null, subWorkflowId: null, subWorkflowName: undefined, queryId: item.id, queryName: item.name,
        name: s.name || item.name, mappings: wireSameName((q?.parameters ?? []).map((p) => p.name)) });
    }
  };

  /** The parameters a step needs values for: its query's parameters, or the nested workflow's inputs. */
  const paramsOf = (s: WorkflowStep): { name: string; label: string; type: ParamType; required: boolean; defaultValue?: string | null }[] => {
    if (s.stepType === 'WORKFLOW') return (allWorkflows.find((x) => x.id === s.subWorkflowId)?.inputs ?? []).map((i) => ({ name: i.name, label: i.label, type: i.type, required: i.required, defaultValue: i.defaultValue }));
    if (s.stepType === 'API_REQUEST') return [];
    return (queryOf(s.queryId)?.parameters ?? []).map((p) => ({ name: p.name, label: p.label, type: p.type, required: p.required, defaultValue: p.defaultValue }));
  };

  /** Runtime = no mapping: the Run dialog asks for the value. Any other source sets (or replaces) the mapping. */
  const setSource = (si: number, paramName: string, source: 'RUNTIME' | SourceType) => {
    const others = w.steps[si].mappings.filter((m) => m.paramName !== paramName);
    if (source === 'RUNTIME') return updStep(si, { mappings: others });
    const m: ParamMapping = source === 'INPUT' ? { paramName, sourceType: 'INPUT', sourceRef: w.inputs[0]?.name ?? '' }
      : source === 'STEP_OUTPUT' ? { paramName, sourceType: 'STEP_OUTPUT', sourceRef: '', sourceField: '' }
        : { paramName, sourceType: 'CONSTANT', constantValue: '' };
    updStep(si, { mappings: [...others, m] });
  };
  const patchMap = (si: number, paramName: string, patch: Partial<ParamMapping>) =>
    updStep(si, { mappings: w.steps[si].mappings.map((m) => (m.paramName === paramName ? { ...m, ...patch } : m)) });

  const save = async () => {
    // a step waits for every step whose output it uses (plus any dependency it already had), so there is no separate field for it
    const clean: Workflow = { ...w, steps: w.steps.map((st) => {
      const used = st.mappings.filter((m) => m.sourceType === 'STEP_OUTPUT').map((m) => parseInt(m.sourceRef ?? '', 10)).filter((n) => !Number.isNaN(n) && n !== st.order);
      return { ...st, dependsOn: Array.from(new Set([...st.dependsOn, ...used])).sort((a, b) => a - b), mappings: st.mappings.filter((m) => m.sourceType !== 'INPUT' || (m.sourceRef ?? '') !== '') };
    }) };
    const saved = await run(() => (clean.id ? api.updateWorkflow(clean.id, clean) : api.createWorkflow(clean)));
    if (saved) onSaved();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{w.id ? 'Edit workflow' : 'New workflow'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField size="small" label="Workflow name" required value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" fullWidth label="Description" value={w.description ?? ''} onChange={(e) => setW({ ...w, description: e.target.value })} />
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            {projects.length > 0 && (
              <TextField size="small" select fullWidth label="Project" required value={w.projectId ?? ''} onChange={(e) => setW({ ...w, projectId: Number(e.target.value), folderId: 0 })}>
                {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              </TextField>
            )}
            <FolderSelect folders={folders.filter((f) => !w.projectId || f.projectId === w.projectId)} value={w.folderId} onChange={(id) => setW({ ...w, folderId: id })}
              noneLabel="No folder (top level of the project)" />
          </Stack>

          <Typography variant="subtitle1" fontWeight={700}>Workflow inputs</Typography>
          <Typography variant="caption" color="text.secondary">Optional. They appear as an optional form when you run the workflow. A default is used when nothing is typed; a required input only blocks the steps that actually need it.</Typography>
          {w.inputs.map((inp, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="center">
              <TextField size="small" label="Name (id)" value={inp.name} onChange={(e) => setW({ ...w, inputs: w.inputs.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} />
              <TextField size="small" label="Label" value={inp.label} onChange={(e) => setW({ ...w, inputs: w.inputs.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
              <TextField size="small" select label="Type" value={inp.type} sx={{ minWidth: 130 }} onChange={(e) => setW({ ...w, inputs: w.inputs.map((x, k) => (k === i ? { ...x, type: e.target.value as ParamType } : x)) })}>
                {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Default (optional)" value={inp.defaultValue ?? ''} sx={{ minWidth: 150 }} placeholder={inp.type === 'BOOLEAN' ? 'true / false' : inp.type === 'DATE' ? 'YYYY-MM-DD' : ''}
                onChange={(e) => setW({ ...w, inputs: w.inputs.map((x, k) => (k === i ? { ...x, defaultValue: e.target.value } : x)) })} />
              <FormControlLabel label="Required" control={<Checkbox checked={inp.required} onChange={(e) => setW({ ...w, inputs: w.inputs.map((x, k) => (k === i ? { ...x, required: e.target.checked } : x)) })} />} />
              <IconButton aria-label="remove input" onClick={() => setW({ ...w, inputs: w.inputs.filter((_, k) => k !== i) })}><DeleteIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => setW({ ...w, inputs: [...w.inputs, { name: '', label: '', type: 'STRING', required: true }] })}>Add input</Button>

          <Typography variant="subtitle1" fontWeight={700}>Steps</Typography>
          {w.steps.map((s, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" type="number" label="Order" value={s.order} sx={{ width: 90 }} onChange={(e) => updStep(i, { order: Number(e.target.value) })} />
                  <TextField size="small" label="Step name" fullWidth value={s.name} onChange={(e) => updStep(i, { name: e.target.value })} />
                  <ToggleButtonGroup size="small" exclusive value={s.stepType ?? 'QUERY'} onChange={(_, v) => v && switchType(i, v)} aria-label="step type">
                    <ToggleButton value="QUERY">DB query</ToggleButton>
                    <ToggleButton value="API_REQUEST">API request</ToggleButton>
                    <ToggleButton value="WORKFLOW">Workflow</ToggleButton>
                  </ToggleButtonGroup>
                  <IconButton aria-label="remove step" onClick={() => setW({ ...w, steps: w.steps.filter((_, k) => k !== i) })}><DeleteIcon /></IconButton>
                </Stack>
                <StepTargetPicker stepType={s.stepType ?? 'QUERY'} items={targetItems} onPick={(item) => pickTarget(i, item, s.stepType ?? 'QUERY')}
                  value={s.stepType === 'WORKFLOW' ? (s.subWorkflowId ? { type: 'WORKFLOW', id: s.subWorkflowId } : null)
                    : s.stepType === 'API_REQUEST' ? (s.apiRequestId ? { type: 'API_REQUEST', id: s.apiRequestId } : null)
                      : (s.queryId ? { type: 'QUERY', id: s.queryId } : null)} />
                <Stack direction="row" spacing={1}>
                  {s.stepType === 'WORKFLOW' ? <Box sx={{ flex: 1 }} /> : <TextField size="small" label="Outputs (alias=COLUMN)" fullWidth value={s.outputFields.map((o) => `${o.alias}=${o.column}`).join(', ')}
                    onChange={(e) => updStep(i, { outputFields: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [a, c] = x.split('='); return { alias: (a ?? '').trim(), column: (c ?? a ?? '').trim() }; }) })} />}
                  {s.stepType !== 'API_REQUEST' && s.stepType !== 'WORKFLOW' && <TextField size="small" type="number" label="Retries" sx={{ width: 90 }} value={s.retryCount} onChange={(e) => updStep(i, { retryCount: Number(e.target.value) })} />}
                  <FormControlLabel label="Stop on failure" control={<Checkbox checked={s.stopOnFailure} onChange={(e) => updStep(i, { stopOnFailure: e.target.checked })} />} />
                </Stack>
                {s.stepType === 'API_REQUEST' && (
                  <Accordion disableGutters variant="outlined">
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="body2">Wait, polling and assertions · values saved by this API call are available to later steps as <code>{'{{variable}}'}</code> or as step outputs</Typography></AccordionSummary>
                    <AccordionDetails><ApiStepOptionsEditor value={s.apiOptions ?? DEFAULT_OPTIONS} onChange={(apiOptions) => updStep(i, { apiOptions })} /></AccordionDetails>
                  </Accordion>
                )}
                {paramsOf(s).map((p) => {
                  const m = s.mappings.find((x) => x.paramName === p.name);
                  const source = m?.sourceType ?? 'RUNTIME';
                  return (
                    <Stack key={p.name} direction="row" spacing={1} alignItems="center" data-testid={`mapping-${i}-${p.name}`}>
                      <Typography sx={{ minWidth: 190, fontFamily: 'monospace' }} variant="body2">
                        {p.name}{p.required ? <Typography component="span" color="error.main"> *</Typography> : null} ←
                      </Typography>
                      <TextField size="small" select label="Source" sx={{ minWidth: 220 }} value={source} onChange={(e) => setSource(i, p.name, e.target.value as 'RUNTIME' | SourceType)}
                        inputProps={{ 'aria-label': `source of ${p.name}` }}>
                        <MenuItem value="RUNTIME">Runtime</MenuItem>
                        <MenuItem value="INPUT" disabled={w.inputs.length === 0}>Workflow input{w.inputs.length === 0 ? ' (add an input first)' : ''}</MenuItem>
                        <MenuItem value="STEP_OUTPUT">Earlier step output</MenuItem>
                        <MenuItem value="CONSTANT">Constant</MenuItem>
                      </TextField>
                      {source === 'RUNTIME' && (
                        <Typography variant="caption" color="text.secondary">Asked when running</Typography>
                      )}
                      {m?.sourceType === 'INPUT' && (
                        <TextField size="small" select label="Input" sx={{ minWidth: 180 }} value={m.sourceRef ?? ''} onChange={(e) => patchMap(i, p.name, { sourceRef: e.target.value })}>
                          {w.inputs.map((x) => <MenuItem key={x.name} value={x.name}>{x.label || x.name}</MenuItem>)}
                        </TextField>
                      )}
                      {m?.sourceType === 'STEP_OUTPUT' && (
                        <>
                          <TextField size="small" select label="From step" sx={{ minWidth: 240 }} value={m.sourceRef ?? ''} onChange={(e) => patchMap(i, p.name, { sourceRef: e.target.value })}>
                            {w.steps.filter((x) => x.order < s.order || String(x.order) === m.sourceRef).map((x) => <MenuItem key={x.order} value={String(x.order)}>{`${x.order}. ${x.name || 'Untitled step'}`}</MenuItem>)}
                          </TextField>
                          <TextField size="small" label="Output field" sx={{ minWidth: 220 }} placeholder="id  /  data.items.0.id" value={m.sourceField ?? ''} onChange={(e) => patchMap(i, p.name, { sourceField: e.target.value })} />
                        </>
                      )}
                      {m?.sourceType === 'CONSTANT' && <TextField size="small" label="Value" value={m.constantValue ?? ''} onChange={(e) => patchMap(i, p.name, { constantValue: e.target.value })} />}
                    </Stack>
                  );
                })}
                {(s.stepType ?? 'QUERY') === 'QUERY' && s.queryId > 0 && queryOf(s.queryId) && <StepTestRun key={`q${s.queryId}`} step={s} inputs={w.inputs} query={queryOf(s.queryId)} />}
                {s.stepType === 'API_REQUEST' && s.apiRequestId && apiRequests.find((r) => r.id === s.apiRequestId) && <StepTestRun key={`a${s.apiRequestId}`} step={s} inputs={w.inputs} apiRequest={apiRequests.find((r) => r.id === s.apiRequestId)} />}
              </Stack>
            </Paper>
          ))}
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => addStep('QUERY')}>Add DB query step</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={() => addStep('API_REQUEST')}>Add API request step</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={() => addStep('WORKFLOW')}>Add workflow</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={loading || !w.name.trim() || w.steps.length === 0 || w.steps.some((s) => (s.stepType === 'API_REQUEST' ? !s.apiRequestId : s.stepType === 'WORKFLOW' ? !s.subWorkflowId : !s.queryId))}>Save workflow</Button>
      </DialogActions>
    </Dialog>
  );
}
