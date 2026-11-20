import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogContent, DialogTitle, IconButton, InputAdornment, MenuItem, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, TablePagination, TableSortLabel, TextField, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { SavedQuery } from '../types';
import QueryEditDialog from '../components/QueryEditDialog';
import QueryRunner from '../components/QueryRunner';
import FolderExplorer, { DRAG_TYPE } from '../components/folders/FolderExplorer';
import FolderPicker from '../components/folders/FolderPicker';
import { folderPaths } from '../components/folders/folderUtils';
import type { Folder } from '../types';
import { ENV_OPTIONS, envColor, envLabel } from '../utils/environments';
import { filterQueries, NO_FILTERS, type QueryFilters } from '../utils/queryFilters';

type SortKey = 'name' | 'category' | 'queryType' | 'enabled';
const MAX_CHIPS = 3;

export default function SavedQueries() {
  const [all, setAll] = useState<SavedQuery[]>([]);
  const [filters, setFilters] = useState<QueryFilters>(NO_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [moving, setMoving] = useState<SavedQuery | null>(null);
  const [editing, setEditing] = useState<SavedQuery | null | undefined>(undefined);
  const [running, setRunning] = useState<SavedQuery | null>(null);
  const { error, setError, run } = useAsync();

  const load = useCallback(async () => {
    await run(async () => {
      const [qs, fs, as] = await Promise.all([api.queries(), api.folders('QUERY'), api.queryFolders()]);
      setAll(qs); setFolders(fs); setAssign(as);
    });
  }, [run]);
  useEffect(() => { void load(); }, [load]);

  const categories = useMemo(() => Array.from(new Set(all.map((q) => q.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)), [all]);
  const set = (patch: Partial<QueryFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };
  const active = Object.entries(filters).some(([, v]) => v !== '');

  const folderOf = useCallback((q: SavedQuery) => assign[String(q.id)] ?? 0, [assign]);
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const directCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const q of all) { const f = folderOf(q); c[f] = (c[f] ?? 0) + 1; }
    return c;
  }, [all, folderOf]);
  const move = async (id: number, folderId: number) => { await run(() => api.moveQuery(id, folderId)); await load(); };
  /** a new query created while inside a folder is filed there */
  const filedAfterSave = async (before: Set<number | undefined>) => {
    const fresh = (await api.queries()).filter((q) => !before.has(q.id));
    if (current !== 0) for (const q of fresh) await api.moveQuery(q.id!, current);
    await load();
  };

  const rows = useMemo(() => {
    // browsing shows the current folder only; searching or filtering looks through every folder
    const scoped = active ? all : all.filter((q) => folderOf(q) === current);
    const out = filterQueries(scoped, filters);
    const dir = desc ? -1 : 1;
    const val = (q: SavedQuery) => sortKey === 'enabled' ? (q.enabled ? 1 : 0) : String(q[sortKey] ?? '').toLowerCase();
    return [...out].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.name.localeCompare(b.name); });
  }, [all, filters, sortKey, desc, active, current, folderOf]);
  const pageRows = rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  const sortBy = (k: SortKey) => { if (k === sortKey) setDesc(!desc); else { setSortKey(k); setDesc(false); } };
  const head = (k: SortKey, text: string) => (
    <TableSortLabel active={sortKey === k} direction={desc ? 'desc' : 'asc'} onClick={() => sortBy(k)}>{text}</TableSortLabel>
  );

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5">Queries Manager</Typography>
          <Typography variant="caption" color="text.secondary">{rows.length} of {all.length} queries</Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New query</Button>
      </Stack>
      <FolderExplorer kind="QUERY" folders={folders} current={current} onNavigate={(id) => { setCurrent(id); setPage(0); }} onChanged={() => void load()}
        directCounts={directCounts} itemLabel="queries" onDropItem={(id, f) => void move(id, f)} />
      <Alert severity="info">Queries are the execution allowlist. Their parameter definitions generate the input forms automatically: adding a query needs no new endpoint or screen.</Alert>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" placeholder="Search name, description, SQL or id" value={filters.search} onChange={(e) => set({ search: e.target.value })} sx={{ minWidth: 320, flex: 1 }}
          inputProps={{ 'aria-label': 'search queries' }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        <TextField size="small" select label="Category" value={filters.category} onChange={(e) => set({ category: e.target.value })} sx={{ minWidth: 160 }}>
          <MenuItem value="">All</MenuItem>
          {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Type" value={filters.type} onChange={(e) => set({ type: e.target.value })} sx={{ minWidth: 120 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="READ">READ</MenuItem><MenuItem value="WRITE">WRITE</MenuItem>
        </TextField>
        <TextField size="small" select label="Environment" value={filters.env} onChange={(e) => set({ env: e.target.value })} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          {ENV_OPTIONS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Enabled" value={filters.enabled} onChange={(e) => set({ enabled: e.target.value })} sx={{ minWidth: 130 }}>
          <MenuItem value="">All</MenuItem><MenuItem value="ENABLED">Enabled</MenuItem><MenuItem value="DISABLED">Disabled</MenuItem>
        </TextField>
        {active && <Button size="small" onClick={() => { setFilters(NO_FILTERS); setPage(0); }}>Clear filters</Button>}
      </Stack>
      <Card>
        <Table size="small" sx={{ '& td': { verticalAlign: 'middle', py: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '34%' }}>{head('name', 'Name')}</TableCell>
              <TableCell>{head('category', 'Category')}</TableCell>
              <TableCell>{head('queryType', 'Type')}</TableCell>
              <TableCell>Parameters</TableCell>
              <TableCell>Environments</TableCell>
              <TableCell>{head('enabled', 'Enabled')}</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {pageRows.map((q) => (
              <TableRow key={q.id} hover draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, String(q.id)); e.dataTransfer.effectAllowed = 'move'; }}
                sx={{ opacity: q.enabled ? 1 : 0.6, cursor: 'grab' }}>
                <TableCell sx={{ maxWidth: 380 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap title={q.name}>{q.name}</Typography>
                  {q.description && <Typography variant="caption" color="text.secondary" noWrap component="div" title={q.description}>{q.description}</Typography>}
                  {active && folderOf(q) !== 0 && <Typography variant="caption" color="primary" noWrap component="div">{paths.get(folderOf(q))}</Typography>}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    {q.category && <Chip size="small" label={q.category} />}
                    {q.databaseName && <Chip size="small" variant="outlined" label={q.databaseName} />}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Chip size="small" label={q.queryType} color={q.queryType === 'WRITE' ? 'warning' : 'default'} />
                    {q.engine === 'MONGODB' && <Chip size="small" variant="outlined" color="secondary" label="MongoDB" />}
                  </Stack>
                </TableCell>
                <TableCell>
                  {q.parameters.length === 0 ? <Typography variant="caption" color="text.disabled">none</Typography> : (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {q.parameters.slice(0, MAX_CHIPS).map((p) => <Chip key={p.name} size="small" variant="outlined" label={p.label || p.name} />)}
                      {q.parameters.length > MAX_CHIPS && (
                        <Tooltip title={q.parameters.slice(MAX_CHIPS).map((p) => p.label || p.name).join(', ')}><Chip size="small" label={`+${q.parameters.length - MAX_CHIPS}`} /></Tooltip>
                      )}
                    </Stack>
                  )}
                </TableCell>
                <TableCell>
                  {q.environments.length === 0 ? <Typography variant="caption" color="text.secondary">All</Typography> : (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {q.environments.map((e) => <Chip key={e} size="small" variant="outlined" color={envColor(e)} label={envLabel(e)} />)}
                    </Stack>
                  )}
                </TableCell>
                <TableCell><Switch size="small" checked={q.enabled} inputProps={{ 'aria-label': `enable ${q.name}` }} onChange={async (e) => { await run(() => api.setQueryEnabled(q.id!, e.target.checked)); await load(); }} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Run"><IconButton size="small" aria-label={`run ${q.name}`} onClick={() => setRunning(q)}><PlayArrowIcon /></IconButton></Tooltip>
                  <Tooltip title="Move to folder"><IconButton size="small" aria-label={`move ${q.name}`} onClick={() => setMoving(q)}><DriveFileMoveIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Edit"><IconButton size="small" aria-label={`edit ${q.name}`} onClick={() => setEditing(q)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Duplicate"><IconButton size="small" aria-label={`duplicate ${q.name}`} onClick={async () => { await run(() => api.duplicateQuery(q.id!)); await load(); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" aria-label={`delete ${q.name}`} onClick={async () => { if (window.confirm(`Delete "${q.name}"?`)) { await run(() => api.deleteQuery(q.id!)); await load(); } }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary">{active ? 'No queries match these filters.' : current === 0 && all.length === 0 ? 'No queries yet. Use New query to add one.' : 'This folder has no queries. Drag queries here or use Move to folder.'}</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
        <TablePagination component="div" count={rows.length} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }} rowsPerPageOptions={[10, 25, 50, 100]} />
      </Card>
      <QueryEditDialog open={editing !== undefined} initial={editing} onClose={() => setEditing(undefined)} onSaved={() => { const before = new Set(all.map((q) => q.id)); const isNew = editing === null; setEditing(undefined); void (isNew ? filedAfterSave(before) : load()); }} />
      <FolderPicker open={!!moving} title={`Move "${moving?.name ?? ''}"`} folders={folders} current={moving ? folderOf(moving) : 0} onClose={() => setMoving(null)}
        onPick={(f) => { const id = moving!.id!; setMoving(null); void move(id, f); }} />
      <Dialog open={!!running} onClose={() => setRunning(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{running?.name}</DialogTitle>
        <DialogContent dividers>{running && <QueryRunner key={running.id} query={running} />}</DialogContent>
      </Dialog>
    </Stack>
  );
}
