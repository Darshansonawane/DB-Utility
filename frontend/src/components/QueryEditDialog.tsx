import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { QueryResult, SavedQuery } from '../types';
import DynamicForm from './DynamicForm';
import ResultTable from './ResultTable';
import { initialValues, missingRequired, ms } from '../utils/format';
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
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<QueryResult | null>(null);
  const mongo = q.engine === 'MONGODB';
  useEffect(() => { if (open && !mongo) api.databases().then((r) => setDbs(r.databases)).catch(() => setDbs([])); }, [open, mongo]);

  useEffect(() => { if (open) { setQ(initial ?? EMPTY); setError(null); setTestResult(null); setTestValues({}); } }, [open, initial, setError]);

  const detect = async () => {
    const a = await run(() => (mongo ? api.mongoAnalyze(q.sql) : api.analyzeSql(q.sql)));
    if (a) setQ((cur) => ({ ...cur, queryType: a.write ? 'WRITE' : 'READ', parameters: a.suggestedParameters.map((s, i) => ({ ...s, ...(cur.parameters[i] && cur.parameters.length === a.placeholders ? { name: cur.parameters[i].name, label: cur.parameters[i].label, type: cur.parameters[i].type, required: cur.parameters[i].required, defaultValue: cur.parameters[i].defaultValue } : {}) })) }));
  };

  // parameters that are typed in by hand need a test value; Automatic ones are resolved from their variable
  const manual = q.parameters.filter((p) => !(p.defaultValue ?? '').trim());
  const execute = async () => {
    const vals = { ...initialValues(manual), ...testValues };
    const missing = missingRequired(manual, vals);
    if (missing.length) return setError(`Enter a test value for: ${missing.join(', ')}`);
    setTestResult(null);
    const r = await run(() => api.testRunQuery(q, vals));
    if (r) setTestResult(r);
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
              helperText={mongo ? 'Empty = active MongoDB database' : 'Empty = database selected in the top bar'} />} />
          <SqlEditorBox value={q.sql} onChange={(v) => setQ({ ...q, sql: v })} height={200} language={mongo ? 'json' : 'sql'} />
          <Stack direction="row" spacing={2} alignItems="center">
            <Button variant="outlined" onClick={detect} disabled={loading || !q.sql.trim()}>Detect parameters from "?"</Button>
            <Tooltip title={q.queryType === 'WRITE' ? "Write queries can't be test-run here. Save it, then run it from the list." : ''}>
              <Box component="span"><Button variant="contained" startIcon={<PlayArrowIcon />} onClick={execute} disabled={loading || !q.sql.trim() || q.queryType === 'WRITE'}>Execute query</Button></Box>
            </Tooltip>
            {mongo && <Button onClick={() => setQ({ ...q, sql: MONGO_EXAMPLE })} disabled={loading}>Insert example</Button>}
            {q.queryType && <Typography variant="body2"><b>{q.queryType}</b></Typography>}
          </Stack>
          <Typography variant="subtitle2">Parameters</Typography>
          <ParamDefinitionEditor parameters={q.parameters} onChange={(parameters) => setQ({ ...q, parameters })} />
          {manual.length > 0 && <DynamicForm parameters={manual} values={{ ...initialValues(manual), ...testValues }} onChange={setTestValues} disabled={loading} />}
          {testResult && (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1}>
                <Chip size="small" color="success" label={testResult.affectedRows != null ? `${testResult.affectedRows} row(s) affected` : `${testResult.rowCount} row(s)`} />
                <Chip size="small" label={ms(testResult.durationMs)} />
              </Stack>
              {testResult.columns.length > 0 && <ResultTable columns={testResult.columns} rows={testResult.rows} truncated={testResult.truncated} maxHeight={260} />}
            </Stack>
          )}
          {q.queryType !== 'WRITE' && <QueryExtractionEditor value={q.extractions ?? []} folders={varFolders.folders} onChange={(extractions) => setQ({ ...q, extractions })} />}
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="body2">Environments (none = all):</Typography>
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
