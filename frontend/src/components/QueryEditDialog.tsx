import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { SavedQuery } from '../types';
import ParamDefinitionEditor from './ParamDefinitionEditor';
import SqlEditorBox from './SqlEditorBox';
import QueryExtractionEditor from './QueryExtractionEditor';
import { useFolders } from './folders/FolderTree';

const EMPTY: SavedQuery = { name: '', description: '', category: '', sql: '', environments: [], enabled: true, parameters: [] };
const ENVS = ['QA', 'UAT'];

interface Props { open: boolean; initial?: SavedQuery | null; onClose: () => void; onSaved: (q: SavedQuery) => void }

export default function QueryEditDialog({ open, initial, onClose, onSaved }: Props) {
  const [q, setQ] = useState<SavedQuery>(EMPTY);
  const { loading, error, setError, run } = useAsync();
  const varFolders = useFolders('VARIABLE');
  const [dbs, setDbs] = useState<string[]>([]);
  useEffect(() => { if (open) api.databases().then((r) => setDbs(r.databases)).catch(() => setDbs([])); }, [open]);

  useEffect(() => { if (open) { setQ(initial ?? EMPTY); setError(null); } }, [open, initial, setError]);

  const detect = async () => {
    const a = await run(() => api.analyzeSql(q.sql));
    if (a) setQ((cur) => ({ ...cur, queryType: a.write ? 'WRITE' : 'READ', parameters: a.suggestedParameters.map((s, i) => ({ ...s, ...(cur.parameters[i] && cur.parameters.length === a.placeholders ? { name: cur.parameters[i].name, label: cur.parameters[i].label, type: cur.parameters[i].type } : {}) })) }));
  };

  const save = async () => {
    const saved = await run(() => (q.id ? api.updateQuery(q.id, q) : api.createQuery(q)));
    if (saved) onSaved(saved);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{q.id ? 'Edit saved query' : 'Save query'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" label="Query name" required fullWidth value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} />
            <TextField size="small" label="Category" fullWidth value={q.category ?? ''} onChange={(e) => setQ({ ...q, category: e.target.value })} />
          </Stack>
          <TextField size="small" label="Description" fullWidth value={q.description ?? ''} onChange={(e) => setQ({ ...q, description: e.target.value })} />
          <Autocomplete freeSolo size="small" options={dbs} value={q.databaseName ?? ''}
            onChange={(_, v) => setQ({ ...q, databaseName: v || null })}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ({ ...q, databaseName: v || null }); }}
            renderInput={(params) => <TextField {...params} label="Run in database (optional)"
              helperText="Leave empty to use the database selected in the top bar. Set it so this query always runs in its own database." />} />
          <SqlEditorBox value={q.sql} onChange={(v) => setQ({ ...q, sql: v })} height={200} />
          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="outlined" onClick={detect} disabled={loading || !q.sql.trim()}>Detect parameters from "?"</Button>
            {q.queryType && <Typography variant="body2">Classified as <b>{q.queryType}</b> (derived from the SQL)</Typography>}
          </Stack>
          <Typography variant="subtitle2">Parameters (one per "?", in order): these generate the input form</Typography>
          <ParamDefinitionEditor parameters={q.parameters} onChange={(parameters) => setQ({ ...q, parameters })} />
          {q.queryType !== 'WRITE' && <QueryExtractionEditor value={q.extractions ?? []} folders={varFolders.folders} onChange={(extractions) => setQ({ ...q, extractions })} />}
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Allowed environments (none = all approved):</Typography>
            {ENVS.map((e) => (
              <FormControlLabel key={e} label={e} control={<Checkbox checked={q.environments.includes(e)}
                onChange={(ev) => setQ({ ...q, environments: ev.target.checked ? [...q.environments, e] : q.environments.filter((x) => x !== e) })} />} />
            ))}
            <FormControlLabel label="Enabled" control={<Checkbox checked={q.enabled} onChange={(ev) => setQ({ ...q, enabled: ev.target.checked })} />} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={loading || !q.name.trim() || !q.sql.trim()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}
