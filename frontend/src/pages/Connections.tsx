import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment, MenuItem,
  Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { api, errMsg, errStatus } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import { CONNECTIONS_CHANGED } from '../hooks/useConnectionStatus';
import { useNotify } from '../components/Notifier';
import { TableSkeleton } from '../components/Skeletons';
import ConnectionStatusBadge from '../components/connections/ConnectionStatusBadge';
import {
  connState, filterConnections, groupConnections, sortConnections,
  type ConnState, type EnvFilter, type Filters, type GroupKey, type SortKey, type StatusFilter, type TypeFilter,
} from '../components/connections/connectionFilters';
import { ENV_OPTIONS, canonicalEnv, envColor, envLabel } from '../utils/environments';
import type { ConnectionRequest, ConnectionView, DbType, StatusView, TestResult } from '../types';

type Form = ConnectionRequest & { id?: number; confirmAccess?: string };

const DEFAULT_PORT: Record<DbType, number> = { MYSQL: 3306, MONGODB: 27017 };
const TYPE_LABEL: Record<DbType, string> = { MYSQL: 'MySQL', MONGODB: 'MongoDB' };
const VIEW_KEY = 'dbutility.connections.view';
const PASSWORD_STATUSES = new Set([403, 428, 429]); // wrong / missing / locked: keep the password prompt open

const blank = (dbType: DbType): Form => ({
  name: '', environment: 'QA', dbType, host: '', port: DEFAULT_PORT[dbType], databaseName: '', username: '', password: '',
  useUri: false, uri: '', authDatabase: '', tls: false, ownerName: '', accessPassword: '', confirmAccess: '',
});

interface View { type: TypeFilter; env: EnvFilter; status: StatusFilter; sort: SortKey; group: GroupKey }
const DEFAULT_VIEW: View = { type: 'ALL', env: 'ALL', status: 'ALL', sort: 'name', group: 'none' };
function readView(): View {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') }; } catch { return DEFAULT_VIEW; }
}

interface Pending { kind: 'test' | 'connect' | 'delete'; conn: ConnectionView; protect: boolean }

/** Asks for the connection's own access password (or lets the first person choose one for an older, unprotected connection). */
function AccessDialog({ pending, onClose, onSubmit }: { pending: Pending | null; onClose: () => void; onSubmit: (p: Pending, password: string) => Promise<string | null> }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPw(''); setPw2(''); setErr(null); setBusy(false); }, [pending]);
  if (!pending) return null;
  const { protect, kind, conn } = pending;
  const verb = kind === 'test' ? 'Test' : kind === 'connect' ? 'Connect' : 'Delete';

  const submit = async () => {
    if (protect && pw !== pw2) { setErr('The two passwords do not match'); return; }
    setBusy(true);
    setErr(null);
    const problem = await onSubmit(pending, pw);
    setBusy(false);
    if (problem) setErr(problem);
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{protect ? `Set an access password for "${conn.name}"` : `${verb} "${conn.name}"`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {err && <Alert severity="error" className="shake">{err}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {protect
              ? 'This connection was created before access passwords existed. Choose one now: it will be required to connect to, test, edit or delete this connection.'
              : 'Enter the access password of this connection. It is separate from the database username and password.'}
          </Typography>
          <TextField size="small" type="password" autoFocus label="Access password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && pw && (!protect || pw2) && !busy) void submit(); }}
            helperText={protect ? 'At least 6 characters' : undefined} />
          {protect && <TextField size="small" type="password" label="Repeat access password" autoComplete="off" value={pw2} onChange={(e) => setPw2(e.target.value)} disabled={busy} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={kind === 'delete' ? 'error' : 'primary'} disabled={busy || !pw || (protect && !pw2)} onClick={submit}>
          {busy ? (kind === 'connect' ? 'Connecting…' : 'Working…') : protect ? `Set password and ${verb.toLowerCase()}` : verb}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface RowProps {
  c: ConnectionView;
  state: ConnState;
  health?: StatusView;
  connecting: boolean;
  flash?: 'ok' | 'bad';
  failedMessage?: string;
  busy: boolean;
  onAsk: (kind: 'test' | 'connect' | 'delete', c: ConnectionView) => void;
  onEdit: (c: ConnectionView) => void;
  onUse: (c: ConnectionView) => void;
  onDisconnect: (c: ConnectionView) => void;
}

const ConnectionRow = memo(function ConnectionRow({ c, state, health, connecting, flash, failedMessage, busy, onAsk, onEdit, onUse, onDisconnect }: RowProps) {
  const typeChip = <Chip size="small" variant="outlined" color={c.dbType === 'MONGODB' ? 'secondary' : 'primary'} label={TYPE_LABEL[c.dbType]} />;
  const envChip = <Chip size="small" label={envLabel(c.environment)} color={envColor(c.environment)} />;
  return (
    <TableRow hover data-testid={`conn-${c.id}`} className={flash === 'ok' ? 'row-success' : flash === 'bad' ? 'row-error' : undefined}>
      <TableCell sx={{ overflow: 'hidden' }}>
        <Typography variant="body2" noWrap title={c.name} sx={{ fontWeight: 600 }}>
          {c.name}
          {!c.passwordProtected && <Tooltip title="No access password yet: you will be asked to set one"><LockIcon fontSize="inherit" color="warning" sx={{ ml: 0.5, verticalAlign: 'middle' }} /></Tooltip>}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'flex', md: 'none' }, mt: 0.5 }}>{typeChip}{envChip}</Stack>
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{typeChip}</TableCell>
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>{envChip}</TableCell>
      <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' }, overflow: 'hidden' }}><Typography variant="body2" noWrap title={`${c.host}:${c.port}`}>{c.host}:{c.port}</Typography></TableCell>
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' }, overflow: 'hidden' }}><Typography variant="body2" noWrap title={c.username ?? ''}>{c.username ?? ''}</Typography></TableCell>
      <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' }, overflow: 'hidden' }}><Typography variant="body2" noWrap title={c.ownerName ?? ''}>{c.ownerName ?? ''}</Typography></TableCell>
      <TableCell>
        <ConnectionStatusBadge state={state} connecting={connecting} active={c.active} fresh={flash !== undefined} message={failedMessage ?? health?.message} />
      </TableCell>
      <TableCell align="right">
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 0.25 }}>
          <Button size="small" disabled={busy || connecting} onClick={() => onAsk('test', c)}>Test</Button>
          {c.connected
            ? <>
              {!c.active && <Tooltip title="Make active: queries of this database type run on this connection"><IconButton size="small" aria-label="make active" disabled={busy} onClick={() => onUse(c)}><SwapHorizIcon fontSize="small" /></IconButton></Tooltip>}
              <Button size="small" color="warning" onClick={() => onDisconnect(c)}>Disconnect</Button>
            </>
            : <Button size="small" variant="contained" disabled={busy || connecting} onClick={() => onAsk('connect', c)}>Connect</Button>}
          <Tooltip title="Edit"><IconButton size="small" aria-label="edit" onClick={() => onEdit(c)}><EditIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Delete"><IconButton size="small" aria-label="delete" onClick={() => onAsk('delete', c)}><DeleteIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
      </TableCell>
    </TableRow>
  );
});

export default function Connections() {
  const [list, setList] = useState<ConnectionView[]>([]);
  const [live, setLive] = useState<Record<number, StatusView>>({});
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<View>(readView);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<Set<number>>(new Set());
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [flash, setFlash] = useState<{ id: number; kind: 'ok' | 'bad' } | null>(null);
  const { loading, error, setError, run } = useAsync();
  const notify = useNotify();
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();
  const deferredQuery = useDeferredValue(query);

  const liveKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    await run(async () => {
      const [conns, statuses] = await Promise.all([api.connections(), api.statuses().catch(() => [] as StatusView[])]);
      const key = conns.filter((c) => c.connected).map((c) => `${c.id}${c.active ? '*' : ''}`).join(',') + '|' + conns.map((c) => c.id).join(',');
      if (liveKey.current !== null && liveKey.current !== key) window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
      liveKey.current = key;
      setList(conns);
      setLive(Object.fromEntries(statuses.filter((s) => s.profileId != null).map((s) => [s.profileId as number, s])));
      setLoaded(true);
    });
  }, [run]);
  useEffect(() => { void load(); }, [load]);
  // Independent health of every live connection (one failing never affects another). Only live connections are pinged.
  useEffect(() => { const t = setInterval(() => void load(), 15_000); return () => clearInterval(t); }, [load]);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* ignore */ } }, [view]);

  const filters: Filters = useMemo(() => ({ query: deferredQuery, type: view.type, env: view.env, status: view.status }), [deferredQuery, view.type, view.env, view.status]);
  const stateOf = useCallback((c: ConnectionView) => connState(c, live[c.id], failed[c.id] !== undefined), [live, failed]);
  const visible = useMemo(() => sortConnections(filterConnections(list, filters, stateOf), view.sort), [list, filters, stateOf, view.sort]);
  const groups = useMemo(() => groupConnections(visible, view.group), [visible, view.group]);
  const connectedCount = useMemo(() => list.filter((c) => c.connected).length, [list]);
  const filtered = filters.query.trim() !== '' || view.type !== 'ALL' || view.env !== 'ALL' || view.status !== 'ALL';

  const showFlash = (id: number, kind: 'ok' | 'bad') => {
    setFlash({ id, kind });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1800);
  };
  const setConnectingId = (id: number, on: boolean) => setConnecting((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const markFailed = (c: ConnectionView, message: string, what: string) => {
    setFailed((f) => ({ ...f, [c.id]: message }));
    showFlash(c.id, 'bad');
    notify.error(`${what} ${c.name}: ${message}`);
  };
  const markOk = (c: ConnectionView) => {
    setFailed((f) => { const n = { ...f }; delete n[c.id]; return n; });
    showFlash(c.id, 'ok');
  };

  const doConnect = async (c: ConnectionView, pw: string): Promise<string | null> => {
    setConnectingId(c.id, true);
    try {
      await api.connect(c.id, pw);
    } catch (e) {
      setConnectingId(c.id, false);
      const msg = errMsg(e);
      if (PASSWORD_STATUSES.has(errStatus(e) ?? 0)) return msg; // wrong access password: stay in the prompt
      markFailed(c, msg, 'Could not connect to');
      return null;
    }
    setConnectingId(c.id, false);
    markOk(c);
    let extra = '';
    try {
      const dbs = await api.databases(c.dbType);
      extra = dbs.restricted ? ' · type a database name to use' : ` · ${dbs.databases.length} database${dbs.databases.length === 1 ? '' : 's'} available`;
    } catch { /* discovery is best effort */ }
    notify.success(`Connected to ${c.name}${extra}`);
    await load();
    return null;
  };

  const doTest = async (c: ConnectionView, pw: string): Promise<string | null> => {
    try {
      const t = await api.testConnection(c.id, pw);
      if (t.success) { markOk(c); notify.success(`${c.name}: connection test passed (${t.latencyMs} ms, ${t.serverVersion})`); }
      else markFailed(c, t.message, 'Test failed for');
      return null;
    } catch (e) {
      if (PASSWORD_STATUSES.has(errStatus(e) ?? 0)) return errMsg(e);
      markFailed(c, errMsg(e), 'Test failed for');
      return null;
    }
  };

  const doDelete = async (c: ConnectionView, pw: string): Promise<string | null> => {
    try {
      await api.deleteConnection(c.id, pw);
    } catch (e) {
      return errMsg(e);
    }
    notify.success(`Deleted ${c.name}`);
    await load();
    return null;
  };

  const submitAccess = async (p: Pending, pw: string): Promise<string | null> => {
    if (p.protect) {
      try { await api.setAccessPassword(p.conn.id, pw); } catch (e) { return errMsg(e); }
    }
    const problem = p.kind === 'connect' ? await doConnect(p.conn, pw) : p.kind === 'test' ? await doTest(p.conn, pw) : await doDelete(p.conn, pw);
    if (!problem) setPending(null);
    return problem;
  };

  const ask = useCallback((kind: 'test' | 'connect' | 'delete', conn: ConnectionView) => {
    setError(null);
    setPending({ kind, conn, protect: !conn.passwordProtected });
  }, [setError]);
  const edit = useCallback((c: ConnectionView) => {
    setForm({ ...blank(c.dbType), id: c.id, name: c.name, environment: canonicalEnv(c.environment), host: c.host, port: c.port, databaseName: c.databaseName ?? '', username: c.username ?? '',
      useUri: c.usesUri, authDatabase: c.authDatabase ?? '', tls: c.tls, ownerName: c.ownerName ?? '' });
    setTest(null);
    setError(null);
  }, [setError]);
  const use = useCallback(async (c: ConnectionView) => { await run(() => api.activateConnection(c.id)); await load(); }, [run, load]);
  const disconnect = useCallback(async (c: ConnectionView) => { await run(() => api.disconnectOne(c.id)); notify.info(`Disconnected ${c.name}`); await load(); }, [run, load, notify]);

  const save = async () => {
    if (!form) return;
    const { id, confirmAccess: _c, ...req } = form;
    if (!id && form.accessPassword !== form.confirmAccess) { setError('The two access passwords do not match'); return; }
    const ok = await run(() => (id ? api.updateConnection(id, req) : api.createConnection(req)));
    if (ok) { notify.success(id ? `Saved ${form.name}` : `Created ${form.name}`); setForm(null); setTest(null); await load(); }
  };

  const clearFilters = () => { setQuery(''); setView((v) => ({ ...v, type: 'ALL', env: 'ALL', status: 'ALL' })); };
  const f = form;
  const mongo = f?.dbType === 'MONGODB';

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h5" sx={{ flex: 1 }}>Database Connections</Typography>
        <Button variant="outlined" onClick={async () => { const r = await run(() => api.openVpn()); if (r) notify.success(`${r.app} opened. Sign in and connect the VPN there.`); }}>Open VPN (FortiClient)</Button>
        <Button variant="contained" onClick={() => { setForm(blank('MYSQL')); setTest(null); setError(null); }}>New connection</Button>
      </Stack>
      <Alert severity="info">
        MySQL and MongoDB connections for QA, Staging and Development; hosts that look like production are rejected. Database passwords are encrypted on the
        backend and never sent back to the browser. Every connection has its own <b>access password</b>: it is needed to connect to, test, edit or delete that
        connection. Several connections can be connected at the same time. After connecting, the databases your database user can access are discovered
        automatically; pick one in the top bar. Connect to your company VPN first: this tool does not bypass any network restriction.
      </Alert>
      {error && !form && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <TextField size="small" fullWidth placeholder="Search by name, host, username, owner or environment…" value={query} onChange={(e) => setQuery(e.target.value)}
            inputProps={{ 'aria-label': 'Search connections' }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: query ? <InputAdornment position="end"><IconButton size="small" aria-label="clear search" onClick={() => setQuery('')}><ClearIcon fontSize="small" /></IconButton></InputAdornment> : undefined,
            }} />
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={view.type} aria-label="database type filter" onChange={(_, v: TypeFilter | null) => v && setView({ ...view, type: v })}>
              <ToggleButton value="ALL" aria-label="All types">All</ToggleButton><ToggleButton value="MYSQL">MySQL</ToggleButton><ToggleButton value="MONGODB">MongoDB</ToggleButton>
            </ToggleButtonGroup>
            <ToggleButtonGroup size="small" exclusive value={view.env} aria-label="environment filter" onChange={(_, v: EnvFilter | null) => v && setView({ ...view, env: v })}>
              <ToggleButton value="ALL" aria-label="All environments">All</ToggleButton>
              {ENV_OPTIONS.map((o) => <ToggleButton key={o.value} value={o.value}>{o.label}</ToggleButton>)}
            </ToggleButtonGroup>
            <TextField select size="small" label="Status" value={view.status} onChange={(e) => setView({ ...view, status: e.target.value as StatusFilter })} sx={{ minWidth: 130 }}>
              <MenuItem value="ALL">All</MenuItem><MenuItem value="CONNECTED">Connected</MenuItem><MenuItem value="IDLE">Idle</MenuItem><MenuItem value="FAILED">Failed</MenuItem>
            </TextField>
            <TextField select size="small" label="Sort by" value={view.sort} onChange={(e) => setView({ ...view, sort: e.target.value as SortKey })} sx={{ minWidth: 150 }}>
              <MenuItem value="name">Name</MenuItem><MenuItem value="recent">Recently added</MenuItem><MenuItem value="type">Database type</MenuItem><MenuItem value="env">Environment</MenuItem>
            </TextField>
            <TextField select size="small" label="Group by" value={view.group} onChange={(e) => setView({ ...view, group: e.target.value as GroupKey })} sx={{ minWidth: 140 }}>
              <MenuItem value="none">No grouping</MenuItem><MenuItem value="type">Database type</MenuItem><MenuItem value="env">Environment</MenuItem>
            </TextField>
            <Box sx={{ flex: 1 }} />
            <Chip label={`Total ${list.length}`} />
            <Chip color="success" variant={connectedCount ? 'filled' : 'outlined'} label={`Connected ${connectedCount}`} />
            {filtered && <Chip color="primary" variant="outlined" label={`Showing ${visible.length} of ${list.length}`} />}
            {filtered && <Button size="small" onClick={clearFilters}>Clear filters</Button>}
          </Stack>
        </Stack>
      </Card>

      <Card sx={{ overflow: 'hidden' }}>
        {!loaded
          ? <TableSkeleton rows={4} columns={6} />
          : (
            <Table size="small" sx={{ tableLayout: 'fixed', width: '100%' }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: { xs: '38%', sm: '30%', md: '22%', lg: '20%' } }}>Connection Name</TableCell>
                  <TableCell sx={{ width: 108, display: { xs: 'none', md: 'table-cell' } }}>Database Type</TableCell>
                  <TableCell sx={{ width: 116, display: { xs: 'none', md: 'table-cell' } }}>Environment</TableCell>
                  <TableCell sx={{ width: { sm: '26%', md: '17%', lg: '15%' }, display: { xs: 'none', sm: 'table-cell' } }}>Host</TableCell>
                  <TableCell sx={{ width: { md: '10%', lg: '8%' }, display: { xs: 'none', md: 'table-cell' } }}>Username</TableCell>
                  <TableCell sx={{ width: '8%', display: { xs: 'none', lg: 'table-cell' } }}>Owner</TableCell>
                  <TableCell sx={{ width: 188 }}>Connection Status</TableCell>
                  <TableCell align="right" sx={{ width: { xs: 190, md: 268 } }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((g) => {
                  const grouped = view.group !== 'none';
                  const isCollapsed = grouped && collapsed[g.key];
                  return [
                    grouped && (
                      <TableRow key={`h-${g.key}`} hover onClick={() => setCollapsed((m) => ({ ...m, [g.key]: !m[g.key] }))} sx={{ cursor: 'pointer', bgcolor: 'action.hover' }} aria-expanded={!isCollapsed}>
                        <TableCell colSpan={8} sx={{ py: 0.75 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <ExpandMoreIcon fontSize="small" sx={{ transition: 'transform 200ms', transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />
                            <Typography variant="subtitle2">{g.label}</Typography>
                            <Chip size="small" label={g.items.length} />
                            {g.items.some((c) => c.connected) && <Chip size="small" color="success" variant="outlined" label={`${g.items.filter((c) => c.connected).length} connected`} />}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ),
                    ...(isCollapsed ? [] : g.items.map((c) => (
                      <ConnectionRow key={c.id} c={c} state={stateOf(c)} health={live[c.id]} connecting={connecting.has(c.id)} flash={flash?.id === c.id ? flash.kind : undefined}
                        failedMessage={failed[c.id]} busy={loading} onAsk={ask} onEdit={edit} onUse={use} onDisconnect={disconnect} />
                    ))),
                  ];
                })}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Stack alignItems="center" spacing={1} sx={{ py: 3 }}>
                        <Typography color="text.secondary">
                          {list.length === 0 ? 'No connections yet. Create one for your QA, Staging or Development database.' : 'No connections match your search and filters.'}
                        </Typography>
                        {list.length > 0 && <Button size="small" onClick={clearFilters}>Clear filters</Button>}
                      </Stack>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
      </Card>

      <AccessDialog pending={pending} onClose={() => setPending(null)} onSubmit={submitAccess} />

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
                  {ENV_OPTIONS.map((e) => <MenuItem key={e.value} value={e.value}>{e.label}</MenuItem>)}
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
                  placeholder="mongodb://user:password@host:27017/?authSource=admin" required={!f.id}
                  helperText={f.id ? 'Leave blank to keep the stored connection string. mongodb+srv:// is supported; insecure TLS options are refused.' : 'Stored encrypted; never shown again. mongodb+srv:// is supported; insecure TLS options are refused.'} />
                : (
                  <Stack direction="row" spacing={2}>
                    <TextField size="small" label="Host" fullWidth value={f.host} onChange={(e) => setForm({ ...f, host: e.target.value })} required />
                    <TextField size="small" label="Port" type="number" sx={{ width: 120 }} value={f.port} onChange={(e) => setForm({ ...f, port: Number(e.target.value) })} />
                  </Stack>
                )}
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
              <Typography variant="caption" color="text.secondary">
                No database name needed: after connecting, the databases this database user can access are listed in the top bar and in the query workspace.
              </Typography>

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
              {test && <Alert severity={test.success ? 'success' : 'error'} className={test.success ? undefined : 'shake'}>{test.success ? `Connection successful (${test.latencyMs} ms, ${test.serverVersion})` : test.message}</Alert>}
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
