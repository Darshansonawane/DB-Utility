import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ApiIcon from '@mui/icons-material/Api';
import StorageIcon from '@mui/icons-material/Storage';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { Workflow } from '../types';
import WorkflowEditDialog from '../components/WorkflowEditDialog';
import WorkflowRunner from '../components/WorkflowRunner';
import FolderExplorer, { DRAG_TYPE } from '../components/folders/FolderExplorer';
import FolderPicker from '../components/folders/FolderPicker';
import { useFolders } from '../components/folders/FolderTree';
import { folderPaths } from '../components/folders/folderUtils';

const MAIN_MICRO = ['Main Business Flows', 'Micro Business Flows'];

function StepChip({ s, onOpenWorkflow }: { s: Workflow['steps'][number]; onOpenWorkflow: (id: number) => void }) {
  const type = s.stepType ?? 'QUERY';
  const icon = type === 'WORKFLOW' ? <AccountTreeIcon /> : type === 'API_REQUEST' ? <ApiIcon /> : <StorageIcon />;
  const detail = type === 'WORKFLOW' ? `Runs workflow: ${s.subWorkflowName ?? ''}` : type === 'API_REQUEST' ? `API: ${s.apiRequestName ?? ''}` : `DB query: ${s.queryName ?? ''}`;
  return (
    <Tooltip title={detail}>
      <Chip size="small" icon={icon} label={`${s.order}. ${s.name}`} color={type === 'WORKFLOW' ? 'secondary' : 'default'} variant={type === 'WORKFLOW' ? 'filled' : 'outlined'}
        onClick={type === 'WORKFLOW' && s.subWorkflowId ? () => onOpenWorkflow(s.subWorkflowId!) : undefined} />
    </Tooltip>
  );
}

export default function WorkflowManager() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [editing, setEditing] = useState<Workflow | null | undefined>(undefined);
  const [running, setRunning] = useState<Workflow | null>(null);
  const [moving, setMoving] = useState<Workflow | null>(null);
  const [current, setCurrent] = useState<number>(0);
  const [search, setSearch] = useState('');
  const { error, setError, run } = useAsync();
  const { folders, reload: reloadFolders } = useFolders('WORKFLOW');

  const load = useCallback(async () => { await run(async () => setWorkflows(await api.workflows())); }, [run]);
  useEffect(() => { void load(); }, [load]);

  const paths = useMemo(() => folderPaths(folders), [folders]);
  const directCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const w of workflows) c[w.folderId ?? 0] = (c[w.folderId ?? 0] ?? 0) + 1;
    return c;
  }, [workflows]);
  const usedIn = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const w of workflows) for (const s of w.steps) if (s.stepType === 'WORKFLOW' && s.subWorkflowId != null) m.set(s.subWorkflowId, [...(m.get(s.subWorkflowId) ?? []), w.name]);
    return m;
  }, [workflows]);
  const q = search.trim().toLowerCase();
  const visible = workflows.filter((w) => (q ? `${w.name} ${w.description ?? ''}`.toLowerCase().includes(q) : (w.folderId ?? 0) === current));
  const byId = (id: number) => workflows.find((w) => w.id === id);
  const move = async (id: number, folderId: number) => { if ((await run(() => api.moveWorkflow(id, folderId))) !== undefined) { await load(); } };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" sx={{ flex: 1 }}>Workflow Manager</Typography>
        <TextField size="small" placeholder="Search all workflows" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 240 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        <Button variant="contained" onClick={() => setEditing(null)}>New workflow</Button>
      </Stack>
      <Alert severity="info">
        Build big business flows from small ones: a workflow can chain saved queries, API requests and <b>other workflows</b> (micro flows).
        Each step takes its inputs from a workflow input, an earlier step's output, a constant or <code>{'{{variable}}'}</code>. Keep main and micro flows in separate folders; drag a workflow onto a folder to move it.
      </Alert>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {!q && (
        <FolderExplorer kind="WORKFLOW" folders={folders} current={current} onNavigate={setCurrent} onChanged={() => { reloadFolders(); void load(); }}
          directCounts={directCounts} itemLabel="workflows" suggested={MAIN_MICRO} onDropItem={(id, folderId) => void move(id, folderId)} />
      )}
      {q && <Typography variant="caption" color="text.secondary">Showing matches from all folders.</Typography>}
      {visible.length === 0 && <Typography color="text.secondary">{q ? 'No workflow matches.' : workflows.length === 0 ? 'No workflows yet.' : 'No workflows in this folder.'}</Typography>}
      {visible.map((w) => (
        <Card key={w.id} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, String(w.id)); e.dataTransfer.effectAllowed = 'move'; }}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled', cursor: 'grab' }} aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                  <Typography variant="h6">{w.name}</Typography>
                  {q && w.folderId ? <Chip size="small" variant="outlined" label={paths.get(w.folderId)} /> : null}
                  {(usedIn.get(w.id!)?.length ?? 0) > 0 && (
                    <Tooltip title={`Used in: ${usedIn.get(w.id!)!.join(', ')}`}><Chip size="small" color="secondary" variant="outlined" icon={<AccountTreeIcon />} label={`Used in ${usedIn.get(w.id!)!.length}`} /></Tooltip>
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary">{w.description}</Typography>
                <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap" useFlexGap>
                  {w.steps.map((s) => <StepChip key={s.order} s={s} onOpenWorkflow={(id) => { const t = byId(id); if (t) setEditing(t); }} />)}
                </Stack>
              </div>
              <Button onClick={() => setRunning(w)}>Run</Button>
              <Button onClick={() => setEditing(w)}>Edit</Button>
              <Tooltip title="Move to folder"><IconButton aria-label={`move ${w.name}`} onClick={() => setMoving(w)}><DriveFileMoveIcon /></IconButton></Tooltip>
              <Button color="error" onClick={async () => { if (window.confirm(`Delete workflow "${w.name}"?`)) { await run(() => api.deleteWorkflow(w.id!)); await load(); } }}>Delete</Button>
            </Stack>
          </CardContent>
        </Card>
      ))}
      <Box />
      <WorkflowEditDialog open={editing !== undefined} initial={editing} folders={folders} defaultFolderId={current} allWorkflows={workflows}
        onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
      {moving && <FolderPicker open title={`Move "${moving.name}" to…`} folders={folders} current={moving.folderId ?? 0} onClose={() => setMoving(null)}
        onPick={(id) => { const m = moving; setMoving(null); void move(m.id!, id); }} />}
      <Dialog open={!!running} onClose={() => setRunning(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{running?.name}</DialogTitle>
        <DialogContent dividers>{running && <WorkflowRunner key={running.id} workflow={running} />}</DialogContent>
      </Dialog>
    </Stack>
  );
}
