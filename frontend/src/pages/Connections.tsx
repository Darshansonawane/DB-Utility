import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { ConnectionRequest, ConnectionView, StatusView, TestResult } from '../types';

type Reach = Record<number, boolean>;
const BLANK: ConnectionRequest = { name: '', environment: 'QA', host: '', port: 3306, databaseName: '', username: '', password: '' };

export default function Connections() {
  const [list, setList] = useState<ConnectionView[]>([]);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [form, setForm] = useState<(ConnectionRequest & { id?: number }) | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach>({});
  const { loading, error, setError, run } = useAsync();

  const load = useCallback(async () => {
    await run(async () => { setList(await api.connections()); setStatus(await api.status()); });
  }, [run]);
  useEffect(() => { void load(); }, [load]);

  // Network reachability of each saved host:port (turns green once the VPN is up).
  useEffect(() => {
    let stop = false;
    const check = async () => {
      const entries = await Promise.all(list.map(async (c) => [c.id, (await api.reachable(c.id).catch(() => ({ reachable: false }))).reachable] as const));
      if (!stop) setReach(Object.fromEntries(entries));
    };
    void check();
    const t = setInterval(() => void check(), 4000);
    return () => { stop = true; clearInterval(t); };
  }, [list]);

  const save = async () => {
    if (!form) return;
    const { id, ...req } = form;
    const ok = await run(() => (id ? api.updateConnection(id, req) : api.createConnection(req)));
    if (ok) { setForm(null); setTest(null); await load(); }
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" sx={{ flex: 1 }}>Database Connections</Typography>
        <Button variant="outlined" onClick={async () => { const r = await run(() => api.openVpn()); if (r) setNotice(`${r.app} opened. Sign in and connect the VPN there; the Network column turns green when the database host is reachable.`); }}>Open VPN (FortiClient)</Button>
        <Button variant="contained" onClick={() => { setForm(BLANK); setTest(null); setError(null); }}>New connection</Button>
      </Stack>
      <Alert severity="info">
        Approved QA/UAT environments only; hosts or databases that look like production are rejected. Passwords are encrypted on the
        backend and never sent back to the browser. Connect to your company VPN first: this tool does not bypass any network restriction.
        Use a least-privilege database account.
      </Alert>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      {status && (
        <Alert severity={status.connected ? 'success' : 'warning'}>
          {status.connected ? `Connected to ${status.connectionName} (${status.environment}) - ${status.host}/${status.databaseName}, ${status.latencyMs} ms` : status.message}
        </Alert>
      )}
      <Card>
        <Table size="small">
          <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Environment</TableCell><TableCell>Host</TableCell><TableCell>Database</TableCell><TableCell>User</TableCell><TableCell>Network</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead>
          <TableBody>
            {list.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell><Chip size="small" label={c.environment} color={c.environment === 'UAT' ? 'warning' : 'success'} /></TableCell>
                <TableCell>{c.host}:{c.port}</TableCell>
                <TableCell>{c.databaseName}</TableCell>
                <TableCell>{c.username}</TableCell>
                <TableCell>{reach[c.id] === undefined ? '…' : <Chip size="small" color={reach[c.id] ? 'success' : 'error'} label={reach[c.id] ? 'Reachable' : 'Unreachable (VPN?)'} />}</TableCell>
                <TableCell>{c.active ? <Chip size="small" color="success" label="Connected" /> : <Chip size="small" variant="outlined" label="Idle" />}</TableCell>
                <TableCell align="right">
                  <Button size="small" disabled={loading} onClick={async () => { const t = await run(() => api.testConnection(c.id)); if (t) setNotice(`${c.name}: ${t.success ? `OK (${t.latencyMs} ms, MySQL ${t.serverVersion})` : `FAILED - ${t.message}`}`); }}>Test</Button>
                  {c.active
                    ? <Button size="small" color="warning" onClick={async () => { await run(() => api.disconnect()); await load(); }}>Disconnect</Button>
                    : <Button size="small" variant="contained" disabled={loading} onClick={async () => { const s = await run(() => api.connect(c.id)); if (s) { setNotice(`Connected to ${c.name}`); await load(); } }}>Connect</Button>}
                  <Tooltip title="Edit"><IconButton size="small" aria-label="edit" onClick={() => { setForm({ ...c, password: '' }); setTest(null); setError(null); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                  <Tooltip title="Delete"><IconButton size="small" aria-label="delete" onClick={async () => { if (window.confirm(`Delete connection "${c.name}"?`)) { await run(() => api.deleteConnection(c.id)); await load(); } }}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {list.length === 0 && <TableRow><TableCell colSpan={8}><Typography color="text.secondary">No connection profiles yet. Create one for your QA or UAT database.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!form} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{form?.id ? 'Edit connection' : 'New connection'}</DialogTitle>
        <DialogContent dividers>
          {form && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField size="small" label="Connection name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <TextField size="small" select label="Environment" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                <MenuItem value="QA">QA</MenuItem><MenuItem value="UAT">UAT</MenuItem>
              </TextField>
              <Stack direction="row" spacing={2}>
                <TextField size="small" label="Host" fullWidth value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} required />
                <TextField size="small" label="Port" type="number" sx={{ width: 120 }} value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} />
              </Stack>
              <TextField size="small" label="Database name" value={form.databaseName} onChange={(e) => setForm({ ...form, databaseName: e.target.value })} required
                helperText="Queries can address other schemas explicitly, e.g. bank_wallet.table or BankInstruction.table" />
              <TextField size="small" label="Username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required autoComplete="off" />
              <TextField size="small" label="Password" type="password" autoComplete="new-password" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })}
                helperText={form.id ? 'Leave blank to keep the stored password' : undefined} required={!form.id} />
              {test && <Alert severity={test.success ? 'success' : 'error'}>{test.success ? `Connection successful (${test.latencyMs} ms, MySQL ${test.serverVersion})` : test.message}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button disabled={loading || !form?.password} onClick={async () => form && setTest((await run(() => api.testConnectionDraft(form))) ?? null)}>Test connection</Button>
          <Button variant="contained" disabled={loading} onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
