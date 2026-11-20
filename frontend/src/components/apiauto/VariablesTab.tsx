import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { Folder, VariableBody, VariableView } from '../../types';
import FolderTree from '../folders/FolderTree';
import FolderPicker, { FolderSelect } from '../folders/FolderPicker';
import { ALL, folderPaths, inSelection } from '../folders/folderUtils';

const SOURCE_LABEL: Record<string, string> = { API: 'API Response', SQL: 'SQL Query', MANUAL: 'Manually Created', SCRIPT: 'Pre-request Script' };
const SOURCE_COLOR: Record<string, 'primary' | 'secondary' | 'default' | 'info'> = { API: 'primary', SQL: 'secondary', MANUAL: 'default', SCRIPT: 'info' };

function scopeLabel(v: VariableView) {
  return v.scope === 'GLOBAL' ? 'Global' : v.scope === 'FOLDER' ? `Folder: ${v.folderPath}` : `${v.environment} only`;
}

function VariableDialog({ initial, folders, defaultFolder, onClose, onSaved }: {
  initial: VariableView | null; folders: Folder[]; defaultFolder: number; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [value, setValue] = useState(initial && !initial.secret ? initial.value : '');
  const [secret, setSecret] = useState(initial?.secret ?? false);
  const [scope, setScope] = useState<string>(initial?.scope ?? 'GLOBAL');
  const [folderId, setFolderId] = useState<number>(initial?.folderId ?? defaultFolder);
  const [env, setEnv] = useState(initial?.environment || 'QA');
  const { loading, error, run } = useAsync();
  const keepSecret = !!initial?.secret && secret && value === '';
  const save = async () => {
    const body: VariableBody = { name: name.trim(), value: keepSecret ? null : value, secret, scope, folderId: folderId || null, environment: scope === 'ENVIRONMENT' ? env : '' };
    if ((await run(() => api.saveVariable(initial?.id, body))) !== undefined) onSaved();
  };
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{initial ? 'Edit variable' : 'New variable'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField size="small" label="Name" required value={name} onChange={(e) => setName(e.target.value)} helperText={`Use it as {{${name || 'name'}}} in requests, scripts, queries and workflows`} />
          <TextField size="small" label="Value" type={secret ? 'password' : 'text'} value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={initial?.secret ? 'Leave empty to keep the current secret' : ''} multiline={!secret} minRows={1} maxRows={6} />
          <FormControlLabel label="Secret (stored encrypted, never shown or logged)" control={<Checkbox checked={secret} onChange={(e) => setSecret(e.target.checked)} />} />
          <TextField size="small" select label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}
            helperText={scope === 'GLOBAL' ? 'Available everywhere.' : scope === 'FOLDER' ? 'Only for requests and workflows stored in the chosen folder (and its subfolders). Overrides Environment and Global.' : 'A separate value used only while that environment is active. Overrides Global.'}>
            <MenuItem value="GLOBAL">Global</MenuItem><MenuItem value="FOLDER">Folder-level</MenuItem><MenuItem value="ENVIRONMENT">Environment-specific</MenuItem>
          </TextField>
          {scope === 'ENVIRONMENT' && (
            <TextField size="small" select label="Environment" value={env} onChange={(e) => setEnv(e.target.value)}>
              <MenuItem value="QA">QA</MenuItem><MenuItem value="STAGING">Staging</MenuItem><MenuItem value="DEV">Development</MenuItem>
            </TextField>
          )}
          <FolderSelect folders={folders} value={folderId} onChange={setFolderId} label={scope === 'FOLDER' ? 'Folder (required)' : 'Folder (organisation only)'} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={loading || !name.trim() || (scope === 'FOLDER' && !folderId)}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Variables: one store for API-extracted, SQL-extracted and manual values, organised in folders, with scopes. */
export default function VariablesTab({ vars, folders, reload, reloadFolders }: { vars: VariableView[]; folders: Folder[]; reload: () => void; reloadFolders: () => void }) {
  const [selected, setSelected] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<VariableView | null | undefined>(undefined);
  const [moving, setMoving] = useState<VariableView | null>(null);
  const [env, setEnv] = useState('');
  const { error, run } = useAsync();
  const paths = useMemo(() => folderPaths(folders), [folders]);
  useEffect(() => { api.activeEnvironment().then((r) => setEnv(r.environment)).catch(() => undefined); }, []);
  const counts = useMemo(() => {
    const c: Record<number, number> = { [ALL]: vars.length, 0: 0 };
    for (const v of vars) c[v.folderId] = (c[v.folderId] ?? 0) + 1;
    return c;
  }, [vars]);
  const visible = vars.filter((v) => inSelection(selected, v.folderId) && (!search.trim() || `${v.name} ${v.sourceName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())));

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
      <FolderTree title="Variables" kind="VARIABLE" folders={folders} selected={selected} onSelect={setSelected} onChanged={() => { reloadFolders(); reload(); }} counts={counts} itemLabel="variables" />
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Alert severity="info">
          Use <code>{'{{name}}'}</code> in any API request, pre-request script, query parameter or workflow. Values come from API responses and SQL results (saved
          automatically by extraction rules) or are created by hand. If the same name exists more than once the most specific wins:
          <b> this run → folder-level → active environment → global</b>. Folders organise variables; a global variable is usable from any folder.
        </Alert>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(null)}>New variable</Button>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">Active environment:</Typography>
            <ToggleButtonGroup size="small" exclusive value={env} aria-label="active environment"
              onChange={async (_, v) => { if (v === null) return; const r = await run(() => api.setActiveEnvironment(v)); if (r) { setEnv(r.environment); reload(); } }}>
              <ToggleButton value="">None</ToggleButton><ToggleButton value="QA">QA</ToggleButton><ToggleButton value="STAGING">Staging</ToggleButton><ToggleButton value="DEV">Development</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
          <TextField size="small" placeholder="Search variables" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ ml: 'auto', minWidth: 220 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        </Stack>
        <Card variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Variable</TableCell><TableCell>Value</TableCell><TableCell>Scope</TableCell><TableCell>Source</TableCell>{selected === ALL && <TableCell>Folder</TableCell>}
                <TableCell align="right">
                  <Button size="small" color="warning" disabled={vars.length === 0} onClick={async () => { if (window.confirm('Delete ALL variables? This cannot be undone.')) { await run(() => api.clearVariables()); reload(); } }}>Clear all</Button>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.length === 0 && <TableRow><TableCell colSpan={6}>{vars.length === 0 ? 'No variables yet. Extract values from an API response or SQL result, or create one.' : 'No variables here.'}</TableCell></TableRow>}
              {visible.map((v) => (
                <TableRow key={v.id} hover>
                  <TableCell><code>{`{{${v.name}}}`}</code></TableCell>
                  <TableCell sx={{ wordBreak: 'break-all', maxWidth: 320 }}>{v.value.length > 120 ? `${v.value.slice(0, 120)}…` : v.value}{v.secret && <Chip size="small" label="secret" sx={{ ml: 1 }} />}</TableCell>
                  <TableCell><Chip size="small" variant="outlined" label={scopeLabel(v)} color={v.scope === 'GLOBAL' ? 'default' : 'warning'} /></TableCell>
                  <TableCell><Tooltip title={v.sourceName ? `from ${v.sourceName}` : ''}><Chip size="small" color={SOURCE_COLOR[v.sourceType] ?? 'default'} label={SOURCE_LABEL[v.sourceType] ?? v.sourceType} /></Tooltip></TableCell>
                  {selected === ALL && <TableCell>{v.folderId ? paths.get(v.folderId) ?? '' : <Typography variant="caption" color="text.secondary">Unfiled</Typography>}</TableCell>}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Edit"><IconButton aria-label={`edit ${v.name}`} onClick={() => setEditing(v)}><EditIcon /></IconButton></Tooltip>
                    <Tooltip title="Move to folder"><IconButton aria-label={`move ${v.name}`} onClick={() => setMoving(v)}><DriveFileMoveIcon /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton aria-label={`delete ${v.name}`} onClick={async () => { if (window.confirm(`Delete variable "${v.name}"?`)) { await run(() => api.deleteVariable(v.id)); reload(); } }}><DeleteIcon /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <Box />
      </Stack>
      {editing !== undefined && <VariableDialog initial={editing} folders={folders} defaultFolder={selected > 0 ? selected : 0} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />}
      {moving && <FolderPicker open title={`Move "${moving.name}" to…`} folders={folders} current={moving.folderId} onClose={() => setMoving(null)}
        onPick={async (id) => { const m = moving; setMoving(null); if ((await run(() => api.moveVariable(m.id, id))) !== undefined) reload(); }} />}
    </Stack>
  );
}
