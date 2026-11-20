import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockIcon from '@mui/icons-material/Lock';
import { api, errMsg } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { CONNECTIONS_CHANGED } from '../hooks/useConnectionStatus';
import type { ConnectionRequest, ConnectionView, DbType, StatusView, TestResult } from '../types';

type Reach = Record<number, boolean>;
type Form = ConnectionRequest & { id?: number; confirmAccess?: string };

const DEFAULT_PORT: Record<DbType, number> = { MYSQL: 3306, MONGODB: 27017 };
const TYPE_LABEL: Record<DbType, string> = { MYSQL: 'MySQL', MONGODB: 'MongoDB' };
const ENVIRONMENTS = [{ value: 'QA', label: 'QA' }, { value: 'UAT', label: 'UAT' }, { value: 'DEV', label: 'Development' }];

const blank = (dbType: DbType): Form => ({
  name: '', environment: 'QA', dbType, host: '', port: DEFAULT_PORT[dbType], databaseName: '', username: '', password: '',
  useUri: false, uri: '', authDatabase: '', tls: false, ownerName: '', accessPassword: '', confirmAccess: '',
});

const envColor = (env: string): 'success' | 'warning' | 'info' => (env === 'UAT' ? 'warning' : env === 'DEV' ? 'info' : 'success');

type Pending =
  | { kind: 'test' | 'connect' | 'delete'; conn: ConnectionView }
  | { kind: 'protect'; conn: ConnectionView; then: 'test' | 'connect' | 'delete' };

/** Asks for the connection's own access password (or lets the first person choose one for an older, unprotected connection). */
function AccessDialog({ pending, onClose, onDone }: { pending: Pending | null; onClose: () => void; onDone: (message: string) => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPw(''); setPw2(''); setErr(null); }, [pending]);
  if (!pending) return null;
  const protect = pending.kind === 'protect';
  const action = protect ? pending.then : pending.kind;
  const verb = action === 'test' ? 'Test' : action === 'connect' ? 'Connect' : 'Delete';

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const c = pending.conn;
      if (protect) {
        if (pw !== pw2) throw new Error('The two passwords do not match');
        await api.setAccessPassword(c.id, pw);
      }
      if (action === 'test') {
        const t = await api.testConnection(c.id, pw);
        onDone(`${c.name}: ${t.success ? `OK (${t.latencyMs} ms, ${t.serverVersion})` : `FAILED - ${t.message}`}`);
      } else if (action === 'connect') {
        await api.connect(c.id, pw);
        onDone(`Connected to ${c.name}`);
      } else {
        await api.deleteConnection(c.id, pw);
        onDone(`Deleted ${c.name}`);
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{protect ? `Set an access password for "${pending.conn.name}"` : `${verb} "${pending.conn.name}"`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {err && <Alert severity="error">{err}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {protect
              ? 'This connection was created before access passwords existed. Choose one now: it will be required to connect to, test, edit or delete this connection.'
              : 'Enter the access password of this connection. It is separate from the database username and password.'}
          </Typography>
          <TextField size="small" type="password" autoFocus label="Access password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && pw && (!protect || pw2)) void submit(); }}
            helperText={protect ? 'At least 6 characters' : undefined} />
          {protect && <TextField size="small" type="password" label="Repeat access password" autoComplete="off" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={action === 'delete' ? 'error' : 'primary'} disabled={busy || !pw || (protect && !pw2)} onClick={submit}>
          {protect ? `Set password and ${verb.toLowerCase()}` : verb}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Connections() {
  const [list, setList] = useState<ConnectionView[]>([]);
  const [live, setLive] = useState<Record<number, StatusView>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const { loading, error, setError, run } = useAsync();

  const liveKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    await run(async () => {
      const [conns, statuses] = await Promise.all([api.connections(), api.statuses().catch(() => [] as StatusView[])]);
      const key = conns.filter((c) => c.connected).map((c) => `${c.id}${c.active ? '*' : ''}`).join(',') + '|' + conns.map((c) => c.id).join(',');
      if (liveKey.current !== null && liveKey.current !== key) window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
      liveKey.current = key;
      setList(conns);
      setLive(Object.fromEntries(statuses.filter((s) => s.profileId != null).map((s) => [s.profileId as number, s])));
    });
  }, [run]);
  useEffect(() => { void load(); }, [load]);
  // Independent health of every live connection (one failing never affects another).
  useEffect(() => { const t = setInterval(() => void load(), 10_000); return () => clearInterval(t); }, [load]);

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

  const ask = (kind: 'test' | 'connect' | 'delete', conn: ConnectionView) => {
    setError(null);
    setPending(conn.passwordProtected ? { kind, conn } : { kind: 'protect', conn, then: kind });
  };

  const save = async () => {
    if (!form) return;
    const { id, confirmAccess: _c, ...req } = form;
    if (!id && form.accessPassword !== form.confirmAccess) { setError('The two access passwords do not match'); return; }
    const ok = await run(() => (id ? api.updateConnection(id, req) : api.createConnection(req)));
    if (ok) { setForm(null); setTest(null); await load(); }
  };

  const connectedList = list.filter((c) => c.connected);
  const f = form;
  const mongo = f?.dbType === 'MONGODB';

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" sx={{ flex: 1 }}>Database Connections</Typography>
        <Button variant="outlined" onClick={async () => { const r = await run(() => api.openVpn()); if (r) setNotice(`${r.app} opened. Sign in and connect the VPN there; the Network column turns green when the database host is reachable.`); }}>Open VPN (FortiClient)</Button>
        <Button variant="contained" onClick={() => { setForm(blank('MYSQL')); setTest(null); setError(null); }}>New connection</Button>
      </Stack>
      <Alert severity="info">
        MySQL and MongoDB connections, approved QA/UAT/Development environments only; hosts or databases that look like production are rejected.
        Database passwords are encrypted on the backend and never sent back to the browser. Every connection has its own <b>access password</b>:
        it is needed to connect to, test, edit or delete that connection. Several connections can be connected at the same time. Connect to your
        company VPN first: this tool does not bypass any network restriction. Use a least-privilege database account.
      </Alert>
      {error && !form && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}
      <Alert severity={connectedList.length ? 'success' : 'warning'}>
        {connectedList.length
          ? `Connected (${connectedList.length}): ${connectedList.map((c) => `${c.name} [${TYPE_LABEL[c.dbType]} ${c.environment}${c.active ? ', active' : ''}]`).join(' · ')}`
          : 'Not connected'}
      </Alert>
      <Card sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell><TableCell>Type</TableCell><TableCell>Environment</TableCell><TableCell>Host</TableCell><TableCell>Database</TableCell>
              <TableCell>User</TableCell><TableCell>Owner</TableCell><TableCell>Network</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((c) => {
              const health = live[c.id];
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    {c.name}
                    {!c.passwordProtected && <Tooltip title="No access password yet: you will be asked to set one"><LockIcon fontSize="inherit" color="warning" sx={{ ml: 0.5, verticalAlign: 'middle' }} /></Tooltip>}
                  </TableCell>
                  <TableCell><Chip size="small" variant="outlined" color={c.dbType === 'MONGODB' ? 'secondary' : 'primary'} label={TYPE_LABEL[c.dbType]} /></TableCell>
                  <TableCell><Chip size="small" label={c.environment === 'DEV' ? 'DEV' : c.environment} color={envColor(c.environment)} /></TableCell>
                  <TableCell>{c.host}:{c.port}</TableCell>
                  <TableCell>{c.databaseName}</TableCell>
                  <TableCell>{c.username ?? ''}</TableCell>
                  <TableCell>{c.ownerName ?? ''}</TableCell>
                  <TableCell>{reach[c.id] === undefined ? '…' : <Chip size="small" color={reach[c.id] ? 'success' : 'error'} label={reach[c.id] ? 'Reachable' : 'Unreachable (VPN?)'} />}</TableCell>
                  <TableCell>
                    {c.connected
                      ? (health && !health.connected
                        ? <Tooltip title={health.message}><Chip size="small" color="error" label="Connection lost" /></Tooltip>
                        : <Chip size="small" color="success" label={c.active ? 'Connected · active' : 'Connected'} />)
                      : <Chip size="small" variant="outlined" label="Idle" />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" disabled={loading} onClick={() => ask('test', c)}>Test</Button>
                    {c.connected
                      ? <>
                        {!c.active && <Button size="small" disabled={loading} onClick={async () => { await run(() => api.activateConnection(c.id)); await load(); }}>Use</Button>}
                        <Button size="small" color="warning" onClick={async () => { await run(() => api.disconnectOne(c.id)); await load(); }}>Disconnect</Button>
                      </>
                      : <Button size="small" variant="contained" disabled={loading} onClick={() => ask('connect', c)}>Connect</Button>}
                    <Tooltip title="Edit"><IconButton size="small" aria-label="edit" onClick={() => { setForm({ ...blank(c.dbType), id: c.id, name: c.name, environment: c.environment, host: c.host, port: c.port, databaseName: c.databaseName, username: c.username ?? '', useUri: c.usesUri, authDatabase: c.authDatabase ?? '', tls: c.tls, ownerName: c.ownerName ?? '' }); setTest(null); setError(null); }}><EditIcon fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton size="small" aria-label="delete" onClick={() => ask('delete', c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {list.length === 0 && <TableRow><TableCell colSpan={10}><Typography color="text.secondary">No connection profiles yet. Create one for your QA, UAT or Development database.</Typography></TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      <AccessDialog pending={pending} onClose={() => setPending(null)} onDone={(m) => { setPending(null); setNotice(m); void load(); }} />

      <Dialog open={!!form} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{f?.id ? 'Edit connection' : 'New connection'}</DialogTitle>
        <DialogContent dividers>
          {f && (
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField size="small" select label="Database type" value={f.dbType} disabled={!!f.id}
                onChange={(e) => { const t = e.target.value as DbType; setForm({ ...f, dbType: t, port: DEFAULT_PORT[t], useUri: false }); setTest(null); }}
                helperText={f.id ? 'The type of an existing connection cannot be changed' : undefined}>
                <MenuItem value="MYSQL">MySQL</MenuItem><MenuItem value="MONGODB">MongoDB</MenuItem>
              </TextField>
              <TextField size="small" label="Connection name" value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })} required />
              <Stack direction="row" spacing={2}>
                <TextField size="small" select label="Environment" fullWidth value={f.environment} onChange={(e) => setForm({ ...f, environment: e.target.value })}>
                  {ENVIRONMENTS.map((e) => <MenuItem key={e.value} value={e.value}>{e.label}</MenuItem>)}
                </TextField>
                <TextField size="small" label="Owner" fullWidth value={f.ownerName ?? ''} onChange={(e) => setForm({ ...f, ownerName: e.target.value })} helperText="Who this connection belongs to" />
              </Stack>

              {mongo && (
                <ToggleButtonGroup size="small" exclusive value={f.useUri ? 'uri' : 'host'} onChange={(_, v) => v && setForm({ ...f, useUri: v === 'uri' })}>
                  <ToggleButton value="host">Host &amp; port</ToggleButton>
                  <ToggleButton value="uri">Connection string (URI)</ToggleButton>
                </ToggleButtonGroup>
              )}
              {mongo && f.useUri
                ? <TextField size="small" type="password" label="MongoDB connection string" autoComplete="off" value={f.uri ?? ''} onChange={(e) => setForm({ ...f, uri: e.target.value })}
                  placeholder="mongodb://user:password@host:27017/database?authSource=admin" required={!f.id}
                  helperText={f.id ? 'Leave blank to keep the stored connection string. mongodb+srv:// is supported; insecure TLS options are refused.' : 'Stored encrypted; never shown again. mongodb+srv:// is supported; insecure TLS options are refused.'} />
                : (
                  <Stack direction="row" spacing={2}>
                    <TextField size="small" label="Host" fullWidth value={f.host} onChange={(e) => setForm({ ...f, host: e.target.value })} required />
                    <TextField size="small" label="Port" type="number" sx={{ width: 120 }} value={f.port} onChange={(e) => setForm({ ...f, port: Number(e.target.value) })} />
                  </Stack>
                )}
              <TextField size="small" label="Database name" value={f.databaseName} onChange={(e) => setForm({ ...f, databaseName: e.target.value })} required={!(mongo && f.useUri)}
                helperText={mongo ? (f.useUri ? 'Optional when the connection string names a database' : undefined) : 'Queries can address other schemas explicitly, e.g. bank_wallet.table or BankInstruction.table'} />
              {!(mongo && f.useUri) && (
                <>
                  <TextField size="small" label="Username" value={f.username} onChange={(e) => setForm({ ...f, username: e.target.value })} required={!mongo} autoComplete="off" />
                  <TextField size="small" label="Password" type="password" autoComplete="new-password" value={f.password ?? ''} onChange={(e) => setForm({ ...f, password: e.target.value })}
                    helperText={f.id ? 'Leave blank to keep the stored password' : (mongo ? 'Required when a username is given' : undefined)} required={!f.id && !mongo} />
                </>
              )}
              {mongo && (
                <Stack direction="row" spacing={2} alignItems="center">
                  <TextField size="small" label="Authentication database" fullWidth value={f.authDatabase ?? ''} onChange={(e) => setForm({ ...f, authDatabase: e.target.value })} placeholder="admin" helperText="Where the user is defined (default admin)" />
                  <FormControlLabel label="Use TLS" control={<Checkbox checked={f.tls || (f.useUri && (f.uri ?? '').startsWith('mongodb+srv://'))} onChange={(e) => setForm({ ...f, tls: e.target.checked })} />} />
                </Stack>
              )}

              {f.id
                ? (
                  <>
                    <TextField size="small" type="password" label="Current access password" autoComplete="off" required value={f.accessPassword ?? ''} onChange={(e) => setForm({ ...f, accessPassword: e.target.value })}
                      helperText="Required to save any change to this connection" />
                    <TextField size="small" type="password" label="New access password (optional)" autoComplete="new-password" value={f.newAccessPassword ?? ''} onChange={(e) => setForm({ ...f, newAccessPassword: e.target.value })} />
                  </>
                )
                : (
                  <Stack direction="row" spacing={2}>
                    <TextField size="small" type="password" label="Access password" fullWidth required autoComplete="new-password" value={f.accessPassword ?? ''} onChange={(e) => setForm({ ...f, accessPassword: e.target.value })}
                      helperText="Needed to use this connection. Not the database password. At least 6 characters." />
                    <TextField size="small" type="password" label="Repeat access password" fullWidth required autoComplete="new-password" value={f.confirmAccess ?? ''} onChange={(e) => setForm({ ...f, confirmAccess: e.target.value })} />
                  </Stack>
                )}
              {test && <Alert severity={test.success ? 'success' : 'error'}>{test.success ? `Connection successful (${test.latencyMs} ms, ${test.serverVersion})` : test.message}</Alert>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)}>Cancel</Button>
          <Button disabled={loading || !f || !!f.id || (mongo && f.useUri ? !f.uri : !f.password && !(mongo && !f.username))}
            onClick={async () => { if (!f) return; const { id: _i, confirmAccess: _c, ...req } = f; setTest((await run(() => api.testConnectionDraft(req))) ?? null); }}>Test connection</Button>
          <Button variant="contained" disabled={loading} onClick={save}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
