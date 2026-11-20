import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, Card, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Skeleton, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ClearIcon from '@mui/icons-material/Clear';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import MenuOpenIcon from '@mui/icons-material/MenuOpen';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { useNotify } from '../components/Notifier';
import type { Folder, Project, Workflow } from '../types';
import WorkflowEditDialog from '../components/WorkflowEditDialog';
import WorkflowRunner from '../components/WorkflowRunner';
import FolderPicker from '../components/folders/FolderPicker';
import { NameDialog } from '../components/folders/FolderTree';
import ProjectCard from '../components/projects/ProjectCard';
import FolderCard from '../components/projects/FolderCard';
import WorkflowCard from '../components/projects/WorkflowCard';
import HierarchyTree from '../components/projects/HierarchyTree';
import { DeleteFolderDialog, DeleteProjectDialog, DeleteWorkflowDialog, MoveWorkflowDialog, ProjectFormDialog } from '../components/projects/ProjectDialogs';
import {
  FOLDER_DRAG, WORKFLOW_DRAG, childFolders, isFiltering, pathLabel, search, subtree, workflowsIn, workflowsUnder,
  type Data, type Filters, type Recency, type StatusFilter,
} from '../components/projects/workflowHierarchy';

const TREE_KEY = 'dbutility.workflows.tree';
const GRID = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 280px), 1fr))', gap: 2 } as const;

type Dlg =
  | { kind: 'project'; project: Project | null }
  | { kind: 'deleteProject'; project: Project }
  | { kind: 'folderName'; mode: 'new' | 'rename'; folder?: Folder }
  | { kind: 'moveFolder'; folder: Folder }
  | { kind: 'deleteFolder'; folder: Folder }
  | { kind: 'moveWorkflow'; workflow: Workflow }
  | { kind: 'deleteWorkflow'; workflow: Workflow };

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1, fontWeight: 700 }}>{title} · {count}</Typography>
      <Box sx={{ mt: 0.5 }}>{children}</Box>
    </Box>
  );
}

function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <Card sx={{ p: 5, textAlign: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: 'divider', boxShadow: 'none' }} className="fade-up">
      <Box sx={{ color: 'text.disabled', mb: 1, '& svg': { fontSize: 48 } }}>{icon}</Box>
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary" sx={{ mb: action ? 2 : 0 }}>{text}</Typography>
      {action}
    </Card>
  );
}

export default function WorkflowManager() {
  const [params, setParams] = useSearchParams();
  const urlProject = Number(params.get('project')) || 0;
  const urlFolder = Number(params.get('folder')) || 0;

  const [data, setData] = useState<Data>({ projects: [], folders: [], workflows: [] });
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [updated, setUpdated] = useState<Recency>('ANY');
  const [executed, setExecuted] = useState<Recency>('ANY');
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [editing, setEditing] = useState<Workflow | null | undefined>(undefined);
  const [running, setRunning] = useState<Workflow | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [showTree, setShowTree] = useState<boolean>(() => { try { return localStorage.getItem(TREE_KEY) !== '0'; } catch { return true; } });
  const { error, setError, run } = useAsync();
  const notify = useNotify();
  const deferredQuery = useDeferredValue(query);

  const load = useCallback(async () => {
    await run(async () => {
      const [projects, folders, workflows] = await Promise.all([api.projects(), api.folders('WORKFLOW'), api.workflows()]);
      setData({ projects, folders, workflows });
      setLoaded(true);
    });
  }, [run]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { try { localStorage.setItem(TREE_KEY, showTree ? '1' : '0'); } catch { /* ignore */ } }, [showTree]);

  // the selection lives in the URL, so links and the browser's back button work; ids that no longer exist fall back to a level up
  const project = data.projects.find((p) => p.id === urlProject);
  const projectId = loaded ? (project ? project.id : 0) : urlProject;
  const folder = data.folders.find((f) => f.id === urlFolder && f.projectId === projectId);
  const folderId = folder ? folder.id : 0;
  const go = useCallback((p: number, f: number) => {
    const next = new URLSearchParams();
    if (p) next.set('project', String(p));
    if (f) next.set('folder', String(f));
    setParams(next);
  }, [setParams]);

  const filters: Filters = useMemo(() => ({ query: deferredQuery, status, updated, executed }), [deferredQuery, status, updated, executed]);
  const filtering = isFiltering(filters);
  const results = useMemo(() => (filtering ? search(data, filters, projectId) : null), [filtering, data, filters, projectId]);
  const usedIn = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const w of data.workflows) for (const s of w.steps) if (s.stepType === 'WORKFLOW' && s.subWorkflowId != null) m.set(s.subWorkflowId, [...(m.get(s.subWorkflowId) ?? []), w.name]);
    return m;
  }, [data.workflows]);
  const clearFilters = () => { setQuery(''); setStatus('ALL'); setUpdated('ANY'); setExecuted('ANY'); };

  // ---- moves (drag and drop and dialogs)
  const act = async (fn: () => Promise<unknown>, okMessage?: string) => {
    try { await fn(); if (okMessage) notify.success(okMessage); await load(); return true; } catch (e) { notify.error(errMsg(e)); return false; }
  };
  const moveWorkflowTo = async (id: number, targetProject: number, targetFolder: number) => {
    const w = data.workflows.find((x) => x.id === id);
    if (!w || ((w.projectId ?? 0) === targetProject && (w.folderId ?? 0) === targetFolder)) return;
    await act(() => api.moveWorkflow(id, targetFolder, targetProject !== w.projectId ? targetProject : undefined), `Moved ${w.name}`);
  };
  const moveFolderTo = async (id: number, targetProject: number, targetFolder: number) => {
    const f = data.folders.find((x) => x.id === id);
    if (!f) return;
    if (f.projectId !== targetProject) { notify.warning('A folder can only be moved within its own project'); return; }
    if (targetFolder === f.parentId || subtree(data.folders, f.id).has(targetFolder)) return;
    await act(() => api.updateFolder(id, { parentId: targetFolder }), `Moved folder ${f.name}`);
  };
  const dropProps = (p: number, f: number): Record<string, unknown> => {
    const key = `${p}:${f}`;
    return {
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes(WORKFLOW_DRAG) || e.dataTransfer.types.includes(FOLDER_DRAG)) { e.preventDefault(); setOver(key); }
      },
      onDragLeave: () => setOver((o) => (o === key ? null : o)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(null);
        const wid = Number(e.dataTransfer.getData(WORKFLOW_DRAG));
        const fid = Number(e.dataTransfer.getData(FOLDER_DRAG));
        if (wid) void moveWorkflowTo(wid, p, f);
        else if (fid) void moveFolderTo(fid, p, f);
      },
    };
  };

  // ---- navigation helpers

  const folderCounts = (f: Folder) => ({ workflows: workflowsUnder(data, f.id).length, subfolders: subtree(data.folders, f.id).size - 1 });
  const projectName = (id: number) => data.projects.find((p) => p.id === id)?.name ?? '';

  const folderCard = (f: Folder, _i: number, withPath = false) => {
    const c = folderCounts(f);
    return (
      <FolderCard key={f.id} folder={f} workflowCount={c.workflows} subfolderCount={childFolders(data, f.projectId ?? 0, f.id).length} over={over === `${f.projectId}:${f.id}`}
        dropProps={dropProps(f.projectId ?? 0, f.id)} path={withPath ? pathLabel(data, f.projectId ?? 0, f.parentId) : undefined}
        onOpen={() => { clearFilters(); go(f.projectId ?? 0, f.id); }} onRename={() => setDlg({ kind: 'folderName', mode: 'rename', folder: f })}
        onMove={() => setDlg({ kind: 'moveFolder', folder: f })} onDelete={() => setDlg({ kind: 'deleteFolder', folder: f })} />
    );
  };
  const workflowCard = (w: Workflow, i: number, withPath = false) => (
    <WorkflowCard key={w.id} w={w} index={i} usedIn={usedIn.get(w.id!)} path={withPath ? pathLabel(data, w.projectId ?? 0, w.folderId ?? 0) : undefined}
      onRun={() => setRunning(w)} onEdit={() => setEditing(w)} onMove={() => setDlg({ kind: 'moveWorkflow', workflow: w })} onDelete={() => setDlg({ kind: 'deleteWorkflow', workflow: w })}
    />
  );
  const projectCard = (p: Project, i: number) => (
    <ProjectCard key={p.id} project={p} index={i} over={over === `${p.id}:0`} dropProps={dropProps(p.id, 0)} onOpen={() => { clearFilters(); go(p.id, 0); }}
      onRename={() => setDlg({ kind: 'project', project: p })} onDelete={() => setDlg({ kind: 'deleteProject', project: p })} />
  );

  const canCreateWorkflow = projectId !== 0;
  const browseFolders = childFolders(data, projectId, folderId);
  const browseWorkflows = workflowsIn(data, projectId, folderId);

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Typography variant="h5" sx={{ flex: 1, minWidth: 180 }}>Workflow Manager</Typography>
        <TextField size="small" placeholder="Search projects, folders and workflows" value={query} onChange={(e) => setQuery(e.target.value)} sx={{ minWidth: { xs: '100%', sm: 340 } }}
          inputProps={{ 'aria-label': 'Search workflows' }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
            endAdornment: query ? <InputAdornment position="end"><IconButton size="small" aria-label="clear search" onClick={() => setQuery('')}><ClearIcon fontSize="small" /></IconButton></InputAdornment> : undefined,
          }} />
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDlg({ kind: 'project', project: null })}>New project</Button>
        <Tooltip title={canCreateWorkflow ? '' : 'Open a project (and optionally a folder) first'}>
          <span><Button variant="contained" startIcon={<AddIcon />} disabled={!canCreateWorkflow} onClick={() => setEditing(null)}>New workflow</Button></span>
        </Tooltip>
      </Stack>

      <Card sx={{ p: 1.5 }}>
        <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
          <TextField select size="small" label="Project" value={projectId} onChange={(e) => go(Number(e.target.value), 0)} sx={{ minWidth: 190 }}>
            <MenuItem value={0}>All projects</MenuItem>
            {data.projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Execution status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} sx={{ minWidth: 170 }}>
            <MenuItem value="ALL">Any status</MenuItem><MenuItem value="SUCCESS">Last run succeeded</MenuItem><MenuItem value="FAILED">Last run failed</MenuItem><MenuItem value="NEVER">Never run</MenuItem>
          </TextField>
          <TextField select size="small" label="Recently updated" value={updated} onChange={(e) => setUpdated(e.target.value as Recency)} sx={{ minWidth: 160 }}>
            <MenuItem value="ANY">Any time</MenuItem><MenuItem value="1d">Last 24 hours</MenuItem><MenuItem value="7d">Last 7 days</MenuItem><MenuItem value="30d">Last 30 days</MenuItem>
          </TextField>
          <TextField select size="small" label="Recently executed" value={executed} onChange={(e) => setExecuted(e.target.value as Recency)} sx={{ minWidth: 170 }}>
            <MenuItem value="ANY">Any time</MenuItem><MenuItem value="1d">Last 24 hours</MenuItem><MenuItem value="7d">Last 7 days</MenuItem><MenuItem value="30d">Last 30 days</MenuItem>
          </TextField>
          {filtering && <Button size="small" onClick={clearFilters}>Clear filters</Button>}
        </Stack>
      </Card>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Stack direction="row" spacing={2} alignItems="flex-start">
        {showTree && loaded && (
          <Card sx={{ width: 270, flexShrink: 0, display: { xs: 'none', md: 'block' }, position: 'sticky', top: 80, maxHeight: 'calc(100vh - 110px)', overflowY: 'auto' }}>
            <HierarchyTree data={data} projectId={projectId} folderId={folderId} onSelect={(p, f) => { clearFilters(); go(p, f); }} drop={dropProps} />
          </Card>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Tooltip title={showTree ? 'Hide navigation tree' : 'Show navigation tree'}>
                <IconButton size="small" aria-label="toggle navigation tree" onClick={() => setShowTree((v) => !v)} sx={{ display: { xs: 'none', md: 'inline-flex' } }}>{showTree ? <MenuOpenIcon /> : <MenuIcon />}</IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              {project && !filtering && (
                <Button size="small" startIcon={<CreateNewFolderIcon />} onClick={() => setDlg({ kind: 'folderName', mode: 'new' })}>New folder{folderId ? ' here' : ''}</Button>
              )}
            </Stack>

            {!loaded ? (
              <Box sx={GRID} aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={150} />)}</Box>
            ) : filtering && results ? (
              <Stack spacing={2.5}>
                <Typography variant="caption" color="text.secondary">
                  {results.projects.length + results.folders.length + results.workflows.length} result{results.projects.length + results.folders.length + results.workflows.length === 1 ? '' : 's'}
                  {projectId ? ` in ${projectName(projectId)}` : ' across all projects'}
                </Typography>
                {results.projects.length > 0 && <Section title="Projects" count={results.projects.length}><Box sx={GRID}>{results.projects.map(projectCard)}</Box></Section>}
                {results.folders.length > 0 && <Section title="Folders" count={results.folders.length}><Box sx={GRID}>{results.folders.map((f, i) => folderCard(f, i, true))}</Box></Section>}
                {results.workflows.length > 0 && <Section title="Workflows" count={results.workflows.length}><Stack spacing={1.5}>{results.workflows.map((w, i) => workflowCard(w, i, true))}</Stack></Section>}
                {results.projects.length + results.folders.length + results.workflows.length === 0 && (
                  <EmptyState icon={<SearchIcon />} title="Nothing matches" text="Try a different word or clear the filters." action={<Button onClick={clearFilters}>Clear filters</Button>} />
                )}
              </Stack>
            ) : projectId === 0 ? (
              data.projects.length === 0
                ? <EmptyState icon={<FolderSpecialIcon />} title="Create your first project" text="A project is an application, product or business domain, for example Savings Wallet or Payments. Folders and workflows live inside it."
                    action={<Button variant="contained" onClick={() => setDlg({ kind: 'project', project: null })}>New project</Button>} />
                : <Box sx={GRID}>{data.projects.map(projectCard)}</Box>
            ) : (
              <Stack spacing={2}>
                {project && folderId === 0 && project.description && <Typography color="text.secondary">{project.description}</Typography>}
                {browseFolders.length > 0 && <Section title="Folders" count={browseFolders.length}><Box sx={GRID}>{browseFolders.map((f, i) => folderCard(f, i))}</Box></Section>}
                {browseWorkflows.length > 0 && <Section title="Workflows" count={browseWorkflows.length}><Stack spacing={1.5}>{browseWorkflows.map((w, i) => workflowCard(w, i))}</Stack></Section>}
                {browseFolders.length === 0 && browseWorkflows.length === 0 && (
                  <EmptyState icon={<FolderSpecialIcon />} title={folderId ? 'This folder is empty' : 'This project is empty'}
                    text={folderId ? 'Create a workflow here, or drag workflows onto it.' : 'Create a folder to organise flows, or add a workflow directly to the project.'}
                    action={<Stack direction="row" spacing={1} justifyContent="center"><Button startIcon={<CreateNewFolderIcon />} onClick={() => setDlg({ kind: 'folderName', mode: 'new' })}>New folder</Button><Button variant="contained" onClick={() => setEditing(null)}>New workflow</Button></Stack>} />
                )}
              </Stack>
            )}
          </Stack>
        </Box>
      </Stack>

      {/* ---- dialogs */}
      {dlg?.kind === 'project' && (
        <ProjectFormDialog project={dlg.project} onClose={() => setDlg(null)} onSave={(name, description) => {
          const d = dlg; setDlg(null);
          void (async () => {
            try {
              if (d.project) { await api.updateProject(d.project.id, name, description); notify.success(`Saved project ${name}`); await load(); }
              else { const created = await api.createProject(name, description); notify.success(`Created project ${name}`); await load(); clearFilters(); go(created.id, 0); }
            } catch (e) { notify.error(errMsg(e)); }
          })();
        }} />
      )}
      {dlg?.kind === 'deleteProject' && (
        <DeleteProjectDialog project={dlg.project} others={data.projects.filter((p) => p.id !== dlg.project.id)} onClose={() => setDlg(null)} onConfirm={(moveTo) => {
          const p = dlg.project; setDlg(null);
          void act(async () => { await api.deleteProject(p.id, moveTo); if (projectId === p.id) go(0, 0); }, `Deleted project ${p.name}`);
        }} />
      )}
      {dlg?.kind === 'folderName' && (
        <NameDialog title={dlg.mode === 'new' ? (folder ? `New folder in ${folder.name}` : `New folder in ${project?.name ?? 'project'}`) : 'Rename folder'} initial={dlg.folder?.name ?? ''} onClose={() => setDlg(null)}
          onSave={(name) => { const d = dlg; setDlg(null); void act(() => (d.mode === 'new' ? api.createFolder('WORKFLOW', folderId, name, projectId) : api.updateFolder(d.folder!.id, { name })), d.mode === 'new' ? `Created folder ${name}` : `Renamed to ${name}`); }} />
      )}
      {dlg?.kind === 'moveFolder' && (
        <FolderPicker open title={`Move folder "${dlg.folder.name}" to…`} folders={data.folders.filter((f) => f.projectId === dlg.folder.projectId)} current={dlg.folder.parentId}
          disabled={subtree(data.folders, dlg.folder.id)} rootLabel="Top level of the project" onClose={() => setDlg(null)}
          onPick={(id) => { const f = dlg.folder; setDlg(null); void moveFolderTo(f.id, f.projectId ?? 0, id); }} />
      )}
      {dlg?.kind === 'deleteFolder' && (() => {
        const c = folderCounts(dlg.folder);
        return (
          <DeleteFolderDialog folder={dlg.folder} workflowCount={c.workflows} subfolderCount={c.subfolders} projectName={projectName(dlg.folder.projectId ?? 0)} onClose={() => setDlg(null)} onConfirm={() => {
            const f = dlg.folder; setDlg(null);
            void act(async () => { await api.deleteFolder(f.id); if (subtree(data.folders, f.id).has(folderId)) go(projectId, f.parentId === f.id ? 0 : f.parentId); }, `Deleted folder ${f.name}`);
          }} />
        );
      })()}
      {dlg?.kind === 'moveWorkflow' && (
        <MoveWorkflowDialog workflow={dlg.workflow} projects={data.projects} folders={data.folders} onClose={() => setDlg(null)}
          onMove={(p, f) => { const w = dlg.workflow; setDlg(null); void moveWorkflowTo(w.id!, p, f); }} />
      )}
      {dlg?.kind === 'deleteWorkflow' && (
        <DeleteWorkflowDialog workflow={dlg.workflow} onClose={() => setDlg(null)} onConfirm={() => { const w = dlg.workflow; setDlg(null); void act(() => api.deleteWorkflow(w.id!), `Deleted ${w.name}`); }} />
      )}

      <WorkflowEditDialog open={editing !== undefined} initial={editing} folders={data.folders} projects={data.projects} defaultProjectId={projectId || undefined} defaultFolderId={folderId}
        allWorkflows={data.workflows} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
      <Dialog open={!!running} onClose={() => { setRunning(null); void load(); }} maxWidth="lg" fullWidth>
        <DialogTitle>{running?.name}</DialogTitle>
        <DialogContent dividers>{running && <WorkflowRunner key={running.id} workflow={running} />}</DialogContent>
      </Dialog>
    </Stack>
  );
}
