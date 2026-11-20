import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { SavedQuery } from '../types';
import ParamDefinitionEditor from './ParamDefinitionEditor';
import SqlEditorBox from './SqlEditorBox';
import QueryExtractionEditor from './QueryExtractionEditor';
import { useFolders } from './folders/FolderTree';
import { ENV_OPTIONS, canonicalEnv } from '../utils/environments';

const EMPTY: SavedQuery = { name: '', description: '', category: '', sql: '', environments: [], enabled: true, parameters: [] };
const ENVS = ENV_OPTIONS;
const MONGO_EXAMPLE = `{
  "collection": "customers",
  "operation": "find",
  "filter": { "customerId": "?" },
  "projection": { "_id": 0 },
  "sort": { "joined": -1 },
  "limit": 50
}`;

interface Props { open: boolean; initial?: SavedQuery | null; onClose: () => void; onSaved: (q: SavedQuery) => void }

export default function QueryEditDialog({ open, initial, onClose, onSaved }: Props) {
  const [q, setQ] = useState<SavedQuery>(EMPTY);
  const { loading, error, setError, run } = useAsync();
  const varFolders = useFolders('VARIABLE');
  const [dbs, setDbs] = useState<string[]>([]);
  const mongo = q.engine === 'MONGODB';
  useEffect(() => { if (open && !mongo) api.databases().then((r) => setDbs(r.databases)).catch(() => setDbs([])); }, [open, mongo]);

  useEffect(() => { if (open) { setQ(initial ?? EMPTY); setError(null); } }, [open, initial, setError]);

  const detect = async () => {
    const a = await run(() => (mongo ? api.mongoAnalyze(q.sql) : api.analyzeSql(q.sql)));
    if (a) setQ((cur) => ({ ...cur, queryType: a.write ? 'WRITE' : 'READ', parameters: a.suggestedParameters.map((s, i) => ({ ...s, ...(cur.parameters[i] && cur.parameters.length === a.placeholders ? { name: cur.parameters[i].name, label: cur.parameters[i].label, type: cur.parameters[i].type, required: cur.parameters[i].required, defaultValue: cur.parameters[i].defaultValue } : {}) })) }));
  };

  const save = async () => {
    const saved = await run(() => (q.id ? api.updateQuery(q.id, q) : api.createQuery(q)));
    if (saved) onSaved(saved);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{q.id ? 'Edit query' : 'New query'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField size="small" select label="Database type" value={q.engine ?? 'MYSQL'} disabled={!!q.id} sx={{ maxWidth: 260 }}
            onChange={(e) => setQ({ ...q, engine: e.target.value as 'MYSQL' | 'MONGODB', queryType: 'READ', sql: e.target.value === 'MONGODB' && !q.sql.trim() ? MONGO_EXAMPLE : q.sql })}
            helperText={q.id ? 'Cannot be changed once saved' : undefined}>
            <MenuItem value="MYSQL">MySQL (SQL)</MenuItem><MenuItem value="MONGODB">MongoDB (JSON query)</MenuItem>
          </TextField>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" label="Query name" required fullWidth value={q.name} onChange={(e) => setQ({ ...q, name: e.target.value })} />
            <TextField size="small" label="Category" fullWidth value={q.category ?? ''} onChange={(e) => setQ({ ...q, category: e.target.value })} />
          </Stack>
          <TextField size="small" label="Description" fullWidth value={q.description ?? ''} onChange={(e) => setQ({ ...q, description: e.target.value })} />
          {mongo && (
            <Alert severity="info" sx={{ whiteSpace: 'pre-wrap' }}>
              A MongoDB query is read-only JSON: <b>collection</b>, <b>operation</b> (find, count, aggregate or distinct), <b>filter</b>, <b>projection</b>, <b>sort</b>, <b>limit</b>,
              <b> skip</b>, <b>pipeline</b> (aggregate) or <b>field</b> (distinct). Write <b>"?"</b> where a value comes from the form; each "?" is one parameter, in document order.
              $where, $function, $out and $merge are not allowed.
            </Alert>
          )}
          <Autocomplete freeSolo size="small" options={dbs} value={q.databaseName ?? ''}
            onChange={(_, v) => setQ({ ...q, databaseName: v || null })}
            onInputChange={(_, v, reason) => { if (reason === 'input') setQ({ ...q, databaseName: v || null }); }}
            renderInput={(params) => <TextField {...params} label="Run in database (optional)"
              helperText={mongo ? 'Leave empty to use the database of the active MongoDB connection.' : 'Leave empty to use the database selected in the top bar. Set it so this query always runs in its own database.'} />} />
          <SqlEditorBox value={q.sql} onChange={(v) => setQ({ ...q, sql: v })} height={200} language={mongo ? 'json' : 'sql'} />
          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="outlined" onClick={detect} disabled={loading || !q.sql.trim()}>Detect parameters from "?"</Button>
            {mongo && <Button onClick={() => setQ({ ...q, sql: MONGO_EXAMPLE })} disabled={loading}>Insert example</Button>}
            {q.queryType && <Typography variant="body2">Classified as <b>{q.queryType}</b> (derived from the SQL)</Typography>}
          </Stack>
          <Typography variant="subtitle2">Parameters (one per "?", in order): these generate the input form</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: '-8px !important' }}>
            Detected parameters are supplied at <b>Runtime</b>: you are asked for the value when the query or workflow runs, so nothing has to be stored here. Switch one to <b>Default value</b> only when it should have a fallback or test value.
          </Typography>
          <ParamDefinitionEditor parameters={q.parameters} onChange={(parameters) => setQ({ ...q, parameters })} />
          {q.queryType !== 'WRITE' && <QueryExtractionEditor value={q.extractions ?? []} folders={varFolders.folders} onChange={(extractions) => setQ({ ...q, extractions })} />}
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Allowed environments (none = all approved):</Typography>
            {ENVS.map((e) => (
              <FormControlLabel key={e.value} label={e.label} control={<Checkbox checked={q.environments.map(canonicalEnv).includes(e.value)}
                onChange={(ev) => setQ({ ...q, environments: ev.target.checked ? [...q.environments.map(canonicalEnv), e.value] : q.environments.map(canonicalEnv).filter((x) => x !== e.value) })} />} />
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
