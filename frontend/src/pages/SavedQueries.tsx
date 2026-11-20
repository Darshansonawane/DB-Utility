import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Chip, Dialog, DialogContent, DialogTitle, IconButton, MenuItem, Stack, Switch, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { SavedQuery } from '../types';
import QueryEditDialog from '../components/QueryEditDialog';
import QueryRunner from '../components/QueryRunner';

export default function SavedQueries() {
  const [queries, setQueries] = useState<SavedQuery[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState<SavedQuery | null | undefined>(undefined);
  const [running, setRunning] = useState<SavedQuery | null>(null);
  const { error, setError, run } = useAsync();

  const load = useCallback(async () => {
    await run(async () => { setQueries(await api.queries(search, category)); setCategories(await api.categories()); });
  }, [run, search, category]);
  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h5" sx={{ flex: 1 }}>Saved Queries</Typography>
        <Button variant="contained" onClick={() => setEditing(null)}>New query</Button>
      </Stack>
      <Alert severity="info">Saved queries are the execution allowlist. Their parameter definitions generate the input forms automatically: adding a query needs no new endpoint or screen.</Alert>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack direction="row" spacing={2}>
        <TextField size="small" label="Search name, description or SQL" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 340 }} />
        <TextField size="small" select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ minWidth: 200 }}>
          <MenuItem value="">All</MenuItem>
          {categories.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
      </Stack>
      <Card>
        <Table size="small">
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Category</TableCell><TableCell>Type</TableCell><TableCell>Parameters</TableCell><TableCell>Envs</TableCell><TableCell>Enabled</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {queries.map((q) => (
              <TableRow key={q.id} hover>
                <TableCell><b>{q.name}</b><Typography variant="caption" display="block" color="text.secondary">{q.description}</Typography></TableCell>
                <TableCell>{q.category}{q.databaseName && <Chip size="small" variant="outlined" label={q.databaseName} sx={{ ml: 1 }} />}</TableCell>
                <TableCell><Chip size="small" label={q.queryType} color={q.queryType === 'WRITE' ? 'warning' : 'default'} /></TableCell>
                <TableCell>{q.parameters.map((p) => p.label).join(', ')}</TableCell>
                <TableCell>{q.environments.length ? q.environments.join(', ') : 'all'}</TableCell>
                <TableCell><Switch size="small" checked={q.enabled} inputProps={{ 'aria-label': `enable ${q.name}` }} onChange={async (e) => { await run(() => api.setQueryEnabled(q.id!, e.target.checked)); await load(); }} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <Tooltip title="Run"><IconButton aria-label={`run ${q.name}`} onClick={() => setRunning(q)}><PlayArrowIcon /></IconButton></Tooltip>
                  <Tooltip title="Edit"><IconButton onClick={() => setEditing(q)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Duplicate"><IconButton onClick={async () => { await run(() => api.duplicateQuery(q.id!)); await load(); }}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton onClick={async () => { if (window.confirm(`Delete "${q.name}"?`)) { await run(() => api.deleteQuery(q.id!)); await load(); } }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {queries.length === 0 && <TableRow><TableCell colSpan={7}><Typography color="text.secondary">No saved queries match.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
      <QueryEditDialog open={editing !== undefined} initial={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load(); }} />
      <Dialog open={!!running} onClose={() => setRunning(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{running?.name}</DialogTitle>
        <DialogContent dividers>{running && <QueryRunner key={running.id} query={running} />}</DialogContent>
      </Dialog>
    </Stack>
  );
}
