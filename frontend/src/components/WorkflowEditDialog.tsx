import { useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Button, ToggleButton, ToggleButtonGroup, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper,
  Autocomplete, Stack, TextField, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ApiStepOptionsEditor, { DEFAULT_OPTIONS } from './ApiStepOptionsEditor';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { FolderSelect } from './folders/FolderPicker';
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

  /** Choosing a workflow to nest: one mapping row per input of that workflow. */
  const pickWorkflow = (i: number, sub: Workflow | null) => updStep(i, {
    subWorkflowId: sub?.id ?? null, subWorkflowName: sub?.name,
    name: w.steps[i].name || (sub?.name ?? ''),
    mappings: (sub?.inputs ?? []).map((inp): ParamMapping => ({
      paramName: inp.name, sourceType: 'INPUT', sourceRef: w.inputs.find((x) => x.name === inp.name)?.name ?? w.inputs[0]?.name ?? '',
    })),
  });

  const pickQuery = (i: number, queryId: number) => {
    const q = queryOf(queryId);
    updStep(i, { queryId, mappings: (q?.parameters ?? []).map((p): ParamMapping => ({ paramName: p.name, sourceType: 'INPUT', sourceRef: w.inputs[0]?.name ?? '' })) });
  };

  const updMap = (si: number, mi: number, patch: Partial<ParamMapping>) =>
    updStep(si, { mappings: w.steps[si].mappings.map((m, k) => (k === mi ? { ...m, ...patch } : m)) });

  const save = async () => {
    const saved = await run(() => (w.id ? api.updateWorkflow(w.id, w) : api.createWorkflow(w)));
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
                  {s.stepType === 'WORKFLOW' ? (
                    <Autocomplete size="small" sx={{ minWidth: 300 }} options={pickable} value={pickable.find((x) => x.id === s.subWorkflowId) ?? null}
                      getOptionLabel={(o) => `${o.name}${o.folderId ? `  (${paths.get(o.folderId) ?? ''})` : ''}`}
                      onChange={(_, v) => pickWorkflow(i, v)} renderInput={(p) => <TextField {...p} label="Workflow to run" />} />
                  ) : s.stepType === 'API_REQUEST' ? (
                    <TextField size="small" select label="API request" sx={{ minWidth: 300 }} value={s.apiRequestId ?? ''}
                      onChange={(e) => { const r = apiRequests.find((x) => x.id === Number(e.target.value)); updStep(i, { apiRequestId: Number(e.target.value), apiRequestName: r?.name, name: s.name || (r?.name ?? '') }); }}>
                      {apiRequests.map((r) => <MenuItem key={r.id} value={r.id}>{r.method} {r.name}</MenuItem>)}
                    </TextField>
                  ) : (
                    <TextField size="small" select label="Query" sx={{ minWidth: 300 }} value={s.queryId || ''} onChange={(e) => pickQuery(i, Number(e.target.value))}>
                      {queries.map((q) => <MenuItem key={q.id} value={q.id}>{q.name}</MenuItem>)}
                    </TextField>
                  )}
                  <IconButton aria-label="remove step" onClick={() => setW({ ...w, steps: w.steps.filter((_, k) => k !== i) })}><DeleteIcon /></IconButton>
                </Stack>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" label="Depends on (step orders, comma separated)" value={s.dependsOn.join(',')} onChange={(e) => updStep(i, { dependsOn: e.target.value.split(',').map((x) => parseInt(x.trim(), 10)).filter((x) => !Number.isNaN(x)) })} />
                  {s.stepType === 'WORKFLOW' ? <Typography variant="caption" color="text.secondary" sx={{ flex: 1, alignSelf: 'center' }}>All outputs of the nested workflow's steps become this step's outputs.</Typography> : <TextField size="small" label="Output fields (optional: alias=COLUMN, ...)" fullWidth value={s.outputFields.map((o) => `${o.alias}=${o.column}`).join(', ')}
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
                {s.mappings.map((m, mi) => (
                  <Stack key={mi} direction="row" spacing={1} alignItems="center">
                    <Typography sx={{ minWidth: 190, fontFamily: 'monospace' }} variant="body2">{m.paramName} ←</Typography>
                    <TextField size="small" select label="Source" sx={{ minWidth: 150 }} value={m.sourceType} onChange={(e) => updMap(i, mi, { sourceType: e.target.value as SourceType })}>
                      <MenuItem value="INPUT">Workflow input</MenuItem><MenuItem value="STEP_OUTPUT">Earlier step output</MenuItem><MenuItem value="CONSTANT">Constant</MenuItem>
                    </TextField>
                    {m.sourceType === 'INPUT' && (
                      <TextField size="small" select label="Input" sx={{ minWidth: 180 }} value={m.sourceRef ?? ''} onChange={(e) => updMap(i, mi, { sourceRef: e.target.value })}>
                        {w.inputs.map((x) => <MenuItem key={x.name} value={x.name}>{x.label || x.name}</MenuItem>)}
                      </TextField>
                    )}
                    {m.sourceType === 'STEP_OUTPUT' && (
                      <>
                        <TextField size="small" label="Step order" sx={{ width: 110 }} value={m.sourceRef ?? ''} onChange={(e) => updMap(i, mi, { sourceRef: e.target.value })} />
                        <TextField size="small" label="Output alias, column or response path" sx={{ minWidth: 260 }} placeholder="id  /  data.items.0.id  /  rows.1.id" value={m.sourceField ?? ''} onChange={(e) => updMap(i, mi, { sourceField: e.target.value })} />
                      </>
                    )}
                    {m.sourceType === 'CONSTANT' && <TextField size="small" label="Value" value={m.constantValue ?? ''} onChange={(e) => updMap(i, mi, { constantValue: e.target.value })} />}
                  </Stack>
                ))}
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
