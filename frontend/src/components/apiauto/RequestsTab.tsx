import { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import { parseCurl } from '../../utils/parseCurl';
import type { ApiRequestDef, ApiRunResult, Folder } from '../../types';
import FolderTree from '../folders/FolderTree';
import FolderPicker from '../folders/FolderPicker';
import { ALL, folderPaths, inSelection } from '../folders/folderUtils';
import RequestDialog, { EMPTY_REQUEST } from './RequestDialog';
import ResultPanel from './ResultPanel';

function CurlImportDialog({ onClose, onParsed }: { onClose: () => void; onParsed: (r: ApiRequestDef, warnings: string[]) => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const go = () => {
    try { const r = parseCurl(text); onParsed(r.request, r.warnings); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Import from cURL</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2">Paste a cURL command (for example Chrome DevTools, Network tab, right-click a request, Copy as cURL (bash), or from Postman). You can review and edit it before saving; nothing is sent yet.</Typography>
          {err && <Alert severity="error">{err}</Alert>}
          <TextField multiline minRows={8} fullWidth autoFocus value={text} onChange={(e) => { setText(e.target.value); setErr(null); }}
            placeholder={"curl -X POST 'https://qa-api.example.com/wallets' -H 'Content-Type: application/json' -d '{\"owner\":\"qa\"}'"}
            slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" onClick={go} disabled={!text.trim()}>Import</Button></DialogActions>
    </Dialog>
  );
}



/** Requests Storage: saved API requests organised in folders (module / feature). */
export default function RequestsTab({ requests, folders, reload, reloadFolders }: {
  requests: ApiRequestDef[]; folders: Folder[]; reload: () => void; reloadFolders: () => void;
}) {
  const [selected, setSelected] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ApiRequestDef | null>(null);
  const [importing, setImporting] = useState(false);
  const [moving, setMoving] = useState<ApiRequestDef | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<{ r: ApiRunResult; name: string } | null>(null);
  const { error, run, loading } = useAsync();
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const counts = useMemo(() => {
    const c: Record<number, number> = { [ALL]: requests.length, 0: 0 };
    for (const r of requests) c[r.folderId ?? 0] = (c[r.folderId ?? 0] ?? 0) + 1;
    return c;
  }, [requests]);
  const visible = requests.filter((q) => inSelection(selected, q.folderId) && (!search.trim() || `${q.name} ${q.url}`.toLowerCase().includes(search.trim().toLowerCase())));
  const targetFolder = selected > 0 ? selected : 0;

  return (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="flex-start">
      <FolderTree title="Requests Storage" kind="REQUEST" folders={folders} selected={selected} onSelect={setSelected} onChanged={() => { reloadFolders(); reload(); }}
        counts={counts} itemLabel="requests" />
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: '100%' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1} alignItems="center">
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setWarnings([]); setEditing({ ...EMPTY_REQUEST, folderId: targetFolder }); }}>New request</Button>
          <Button variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => setImporting(true)}>Import from cURL</Button>
          <TextField size="small" placeholder="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ ml: 'auto', minWidth: 220 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        </Stack>
        {warnings.length > 0 && <Alert severity="warning" onClose={() => setWarnings([])}>{warnings.map((w) => <div key={w}>{w}</div>)}</Alert>}
        <Card variant="outlined">
          <Table size="small">
            <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Method</TableCell><TableCell>URL</TableCell><TableCell>Saves</TableCell>{selected === ALL && <TableCell>Folder</TableCell>}<TableCell align="right">Actions</TableCell></TableRow></TableHead>
            <TableBody>
              {visible.length === 0 && <TableRow><TableCell colSpan={6}>{requests.length === 0 ? 'No requests yet. Create one, or import a cURL command.' : 'No requests in this folder.'}</TableCell></TableRow>}
              {visible.map((q) => (
                <TableRow key={q.id} hover>
                  <TableCell>{q.name}</TableCell>
                  <TableCell><Chip size="small" label={q.method} /></TableCell>
                  <TableCell sx={{ wordBreak: 'break-all' }}>{q.url}</TableCell>
                  <TableCell>{q.extractions.map((x) => <Chip key={x.variable} size="small" variant="outlined" label={x.variable} sx={{ mr: 0.5 }} />)}</TableCell>
                  {selected === ALL && <TableCell>{q.folderId ? paths.get(q.folderId) ?? '' : <Typography variant="caption" color="text.secondary">Unfiled</Typography>}</TableCell>}
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title="Send now"><span><IconButton disabled={loading} onClick={async () => { const x = await run(() => api.runApiRequest(q)); if (x) { setResult({ r: x, name: q.name }); reload(); } }}><PlayArrowIcon /></IconButton></span></Tooltip>
                    <Tooltip title="Edit"><IconButton onClick={() => setEditing(q)}><EditIcon /></IconButton></Tooltip>
                    <Tooltip title="Move to folder"><IconButton aria-label={`move ${q.name}`} onClick={() => setMoving(q)}><DriveFileMoveIcon /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={async () => { if (window.confirm(`Delete "${q.name}"?`) && (await run(() => api.deleteApiRequest(q.id!)) !== undefined)) reload(); }}><DeleteIcon /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        {result && <Box><Typography variant="subtitle2" sx={{ mb: 0.5 }}>Last run: {result.name}</Typography><ResultPanel r={result.r} folders={folders} requestName={result.name} /></Box>}
      </Stack>
      {importing && <CurlImportDialog onClose={() => setImporting(false)} onParsed={(r, w) => { setImporting(false); setWarnings(w); setEditing({ ...r, folderId: targetFolder }); }} />}
      {editing && <RequestDialog initial={editing} folders={folders} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {moving && <FolderPicker open title={`Move "${moving.name}" to…`} folders={folders} current={moving.folderId ?? 0} onClose={() => setMoving(null)}
        onPick={async (id) => { const m = moving; setMoving(null); if ((await run(() => api.moveApiRequest(m.id!, id))) !== undefined) reload(); }} />}
    </Stack>
  );
}
