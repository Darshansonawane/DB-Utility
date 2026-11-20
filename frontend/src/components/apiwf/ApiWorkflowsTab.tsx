import { useCallback, useEffect, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, IconButton, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { ApiRequestDef, ApiWfStep, ApiWorkflowDef, Folder, SavedQuery } from '../../types';
import ApiStepOptionsEditor, { DEFAULT_OPTIONS } from '../ApiStepOptionsEditor';
import FolderTree from '../folders/FolderTree';
import FolderPicker, { FolderSelect } from '../folders/FolderPicker';
import { ALL, folderPaths, inSelection } from '../folders/folderUtils';
import VariableInput from '../apiauto/VariableInput';

const NEW_WF: ApiWorkflowDef = { name: '', description: '', publishGlobal: true, maxRunSeconds: 1800, steps: [], folderId: 0 };

function optionsSummary(s: ApiWfStep): string {
  const o = s.options;
  const parts: string[] = [];
  if (o.waitBeforeSeconds > 0) parts.push(`wait ${o.waitBeforeSeconds}s`);
  if (o.until.length > 0) parts.push(`poll ≤${o.maxAttempts}× / ${o.pollIntervalSeconds}s`);
  else if (o.maxAttempts > 1) parts.push(`retry ≤${o.maxAttempts}×`);
  if (o.assertions.length > 0) parts.push(`${o.assertions.length} assertion(s)`);
  return parts.join(' · ');
}

function RunVariablesDialog({ wf, onClose, onStart }: { wf: { name: string; count: number }; onClose: () => void; onStart: (inputs: Record<string, string>) => void }) {
  const [rows, setRows] = useState<{ k: string; v: string }[]>([]);
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Run {wf.name}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5} sx={{ mt: 0.5 }}>
          <Alert severity="warning" sx={{ py: 0 }}>This sends real API requests from {wf.count} workflow(s) to your QA, Staging or Development environment.</Alert>
          <Typography variant="body2">Optional run variables, available as {'{{name}}'} in this run only (for example a customer id).</Typography>
          {rows.map((r, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField size="small" label="Name" value={r.k} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
              <TextField size="small" label="Value" fullWidth value={r.v} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
              <IconButton aria-label="remove variable" onClick={() => setRows(rows.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>
            </Stack>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => setRows([...rows, { k: '', v: '' }])}>Add variable</Button></Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => onStart(Object.fromEntries(rows.filter((r) => r.k.trim()).map((r) => [r.k.trim(), r.v])))}>Start</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ApiWorkflowsTab({ requests, workflows: list, folders, reloadFolders, reload, onStarted }: {
  requests: ApiRequestDef[]; workflows: ApiWorkflowDef[]; folders: Folder[]; reloadFolders: () => void; reload: () => void; onStarted: (runIds: string[]) => void;
}) {
  const [selectedFolder, setSelectedFolder] = useState<number>(ALL);
  const [moving, setMoving] = useState<ApiWorkflowDef | null>(null);
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  useEffect(() => { api.queries().then(setQueries).catch(() => undefined); }, []);
  const [editing, setEditing] = useState<ApiWorkflowDef | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [runTarget, setRunTarget] = useState<number[] | null>(null);
  const { error, setError, run, loading } = useAsync();
  const load = useCallback(() => { reload(); }, [reload]);
  const paths = folderPaths(folders);
  const counts: Record<number, number> = { [ALL]: list.length, 0: 0 };
  for (const w of list) counts[w.folderId ?? 0] = (counts[w.folderId ?? 0] ?? 0) + 1;
  const visible = list.filter((w) => inSelection(selectedFolder, w.folderId));

  const start = async (ids: number[], inputs: Record<string, string>) => {
    setRunTarget(null);
    const r = await run(() => (ids.length === 1 ? api.runApiWorkflow(ids[0], inputs).then((x) => ({ runIds: [x.runId] })) : api.runApiWorkflows(ids, inputs)));
    if (r) { setSelected([]); onStarted(r.runIds); }
  };
  const save = async () => { if (editing && (await run(() => api.saveApiWorkflow(editing))) !== undefined) { setEditing(null); void load(); } };
  const updStep = (i: number, p: Partial<ApiWfStep>) => editing && setEditing({ ...editing, steps: editing.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: number) => {
    if (!editing) return;
    const steps = [...editing.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setEditing({ ...editing, steps });
  };
  const reqOf = (id: number) => requests.find((r) => r.id === id);
  const names = (ids: number[]) => list.filter((w) => ids.includes(w.id!)).map((w) => w.name).join(', ');

  const queryOf = (id?: number | null) => queries.find((q) => q.id === id);
  const addStep = (sql: boolean) => editing && setEditing({
    ...editing,
    steps: [...editing.steps, {
      order: editing.steps.length + 1, name: '', requestId: 0, onFailure: 'STOP', enabled: true, options: { ...DEFAULT_OPTIONS },
      stepType: sql ? 'SQL_QUERY' : 'API_REQUEST', queryId: null, paramValues: {},
    }],
  });

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
      <FolderTree title="API Workflows" kind="API_WORKFLOW" folders={folders} selected={selectedFolder} onSelect={setSelectedFolder}
        onChanged={() => { reloadFolders(); reload(); }} counts={counts} itemLabel="workflows" />
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ ...NEW_WF, folderId: selectedFolder > 0 ? selectedFolder : 0 })}>New API workflow</Button>
          <Button variant="outlined" startIcon={<PlayArrowIcon />} disabled={selected.length === 0 || loading} onClick={() => setRunTarget(selected)}>Run selected ({selected.length})</Button>
        </Stack>
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell padding="checkbox" /><TableCell>Workflow</TableCell><TableCell>Steps (in order)</TableCell>{selectedFolder === ALL && <TableCell>Folder</TableCell>}<TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {visible.length === 0 && <TableRow><TableCell colSpan={5}>{list.length === 0 ? 'No API workflows yet. Chain saved API requests and SQL queries, with waits and polling, and run them end to end.' : 'No workflows in this folder.'}</TableCell></TableRow>}
              {visible.map((w) => (
                <TableRow key={w.id} hover>
                  <TableCell padding="checkbox"><Checkbox inputProps={{ 'aria-label': `select ${w.name}` }} checked={selected.includes(w.id!)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, w.id!] : selected.filter((x) => x !== w.id))} /></TableCell>
                  <TableCell>{w.name}{w.description && <Typography variant="caption" display="block" color="text.secondary">{w.description}</Typography>}</TableCell>
                  <TableCell>{w.steps.map((s) => (
                    <Tooltip key={s.order} title={`${s.stepType === 'SQL_QUERY' ? 'SQL: ' + (s.queryName ?? '') : 'API: ' + (s.requestName ?? '')}${optionsSummary(s) ? ' · ' + optionsSummary(s) : ''}`}>
                      <Chip size="small" sx={{ mr: 0.5, mb: 0.5 }} color={s.stepType === 'SQL_QUERY' ? 'secondary' : 'default'} variant={s.enabled ? 'filled' : 'outlined'} label={`${s.order}. ${s.name}`} />
                    </Tooltip>
                  ))}</TableCell>
                  {selectedFolder === ALL && <TableCell>{w.folderId ? paths.get(w.folderId) ?? '' : <Typography variant="caption" color="text.secondary">Unfiled</Typography>}</TableCell>}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Run"><span><IconButton disabled={loading} onClick={() => setRunTarget([w.id!])}><PlayArrowIcon /></IconButton></span></Tooltip>
                    <Tooltip title="Edit"><IconButton onClick={() => setEditing(structuredClone(w))}><EditIcon /></IconButton></Tooltip>
                    <Tooltip title="Move to folder"><IconButton aria-label={`move ${w.name}`} onClick={() => setMoving(w)}><DriveFileMoveIcon /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={async () => { if (window.confirm(`Delete "${w.name}"? Its run history is kept.`)) { await run(() => api.deleteApiWorkflow(w.id!)); void load(); } }}><DeleteIcon /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </Stack>
      {runTarget && <RunVariablesDialog wf={{ name: runTarget.length === 1 ? names(runTarget) : `${runTarget.length} workflows`, count: runTarget.length }} onClose={() => setRunTarget(null)} onStart={(inp) => void start(runTarget, inp)} />}
      {moving && <FolderPicker open title={`Move "${moving.name}" to…`} folders={folders} current={moving.folderId ?? 0} onClose={() => setMoving(null)}
        onPick={async (id) => { const m = moving; setMoving(null); if ((await run(() => api.moveApiWorkflow(m.id!, id))) !== undefined) void load(); }} />}
      {editing && (
        <Dialog open onClose={() => setEditing(null)} maxWidth="lg" fullWidth>
          <DialogTitle>{editing.id ? 'Edit API workflow' : 'New API workflow'}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField size="small" label="Workflow name" required fullWidth value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                <Box sx={{ minWidth: 240 }}><FolderSelect folders={folders} value={editing.folderId} onChange={(id) => setEditing({ ...editing, folderId: id })} /></Box>
                <TextField size="small" type="number" label="Max run time (s)" value={editing.maxRunSeconds} sx={{ minWidth: 170 }} onChange={(e) => setEditing({ ...editing, maxRunSeconds: Number(e.target.value) })} />
              </Stack>
              <TextField size="small" label="Description" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              <FormControlLabel label="Also save extracted variables to the shared Variables store (usable in queries; with parallel runs the latest run wins there)"
                control={<Checkbox checked={editing.publishGlobal} onChange={(e) => setEditing({ ...editing, publishGlobal: e.target.checked })} />} />
              <Typography variant="subtitle1" fontWeight={700}>Steps</Typography>
              {editing.steps.map((s, i) => {
                const sql = s.stepType === 'SQL_QUERY';
                const q = queryOf(s.queryId);
                return (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={1}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
                        <Chip label={s.order} size="small" />
                        <ToggleButtonGroup size="small" exclusive value={sql ? 'SQL_QUERY' : 'API_REQUEST'} aria-label="step type"
                          onChange={(_, v) => v && updStep(i, v === 'SQL_QUERY' ? { stepType: v, requestId: 0, requestName: undefined, requestMethod: undefined } : { stepType: v, queryId: null, queryName: undefined, paramValues: {} })}>
                          <ToggleButton value="API_REQUEST">API request</ToggleButton><ToggleButton value="SQL_QUERY">SQL query</ToggleButton>
                        </ToggleButtonGroup>
                        <TextField size="small" label="Step name" value={s.name} sx={{ minWidth: 220 }} onChange={(e) => updStep(i, { name: e.target.value })} />
                        {sql ? (
                          <Autocomplete size="small" fullWidth options={queries} getOptionLabel={(o) => o.name} value={q ?? null}
                            onChange={(_, v) => updStep(i, { queryId: v?.id ?? null, queryName: v?.name, paramValues: {}, name: s.name || (v?.name ?? '') })}
                            renderInput={(p) => <TextField {...p} label="Saved SQL query (SELECT, INSERT, UPDATE or DELETE)" />} />
                        ) : (
                          <Autocomplete size="small" fullWidth options={requests} getOptionLabel={(o) => `${o.method} ${o.name}`} value={reqOf(s.requestId) ?? null}
                            onChange={(_, v) => updStep(i, { requestId: v?.id ?? 0, requestName: v?.name, requestMethod: v?.method, name: s.name || (v?.name ?? '') })}
                            renderInput={(p) => <TextField {...p} label="API request" />} />
                        )}
                        <TextField size="small" select label="If it fails" value={s.onFailure} sx={{ minWidth: 150 }} onChange={(e) => updStep(i, { onFailure: e.target.value as 'STOP' | 'CONTINUE' })}>
                          <MenuItem value="STOP">Stop workflow</MenuItem><MenuItem value="CONTINUE">Continue</MenuItem>
                        </TextField>
                        <FormControlLabel label="On" control={<Checkbox checked={s.enabled} onChange={(e) => updStep(i, { enabled: e.target.checked })} />} />
                        <IconButton aria-label="move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
                        <IconButton aria-label="move down" disabled={i === editing.steps.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
                        <IconButton aria-label="remove step" onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, k) => k !== i).map((x, k) => ({ ...x, order: k + 1 })) })}><DeleteIcon /></IconButton>
                      </Stack>
                      {sql && q && (
                        <Stack spacing={1} sx={{ pl: 1 }}>
                          {q.parameters.length === 0 && <Typography variant="caption" color="text.secondary">This query has no parameters.</Typography>}
                          {q.parameters.map((p) => (
                            <VariableInput key={p.name} label={`${p.label}${p.required ? ' *' : ''}`} value={s.paramValues?.[p.name] ?? ''}
                              placeholder={p.defaultValue ? `default: ${p.defaultValue}` : '{{variable}} or a value'}
                              helperText="Bound as a SQL parameter (never concatenated). Leave empty to use the query's default / mapped variable."
                              onChange={(v) => updStep(i, { paramValues: { ...(s.paramValues ?? {}), [p.name]: v } })} />
                          ))}
                          {(q.extractions?.length ?? 0) > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              Saves from the first result row: {q.extractions!.map((x) => `${x.column} → {{${x.variable}}}`).join(', ')}. The step retries until a row exists when attempts &gt; 1.
                            </Typography>
                          )}
                        </Stack>
                      )}
                      <Accordion disableGutters variant="outlined">
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                          <Typography variant="body2">{sql ? 'Wait and retry' : 'Wait, polling and assertions'} {optionsSummary(s) && <Chip size="small" sx={{ ml: 1 }} label={optionsSummary(s)} />}</Typography>
                        </AccordionSummary>
                        <AccordionDetails><ApiStepOptionsEditor sql={sql} value={s.options} onChange={(options) => updStep(i, { options })} /></AccordionDetails>
                      </Accordion>
                    </Stack>
                  </Paper>
                );
              })}
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addStep(false)}>Add API step</Button>
                <Button size="small" startIcon={<AddIcon />} onClick={() => addStep(true)}>Add SQL step</Button>
              </Stack>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="contained" onClick={save} disabled={loading || !editing.name.trim() || editing.steps.length === 0 || editing.steps.some((s) => (s.stepType === 'SQL_QUERY' ? !s.queryId : !s.requestId) || !s.name.trim())}>Save workflow</Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
