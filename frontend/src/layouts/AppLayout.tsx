import { useEffect, useState } from 'react';
import { AppBar, MenuItem, Select, Snackbar, Box, Chip, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Tooltip, Typography } from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DashboardIcon from '@mui/icons-material/Dashboard';
import StorageIcon from '@mui/icons-material/Storage';
//import CodeIcon from '@mui/icons-material/Code';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
//import SavingsIcon from '@mui/icons-material/Savings';
import ApiIcon from '@mui/icons-material/Api';
import HistoryIcon from '@mui/icons-material/History';
import SettingsIcon from '@mui/icons-material/Settings';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { NavLink, Outlet } from 'react-router-dom';
import { api } from '../services/api';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import Logo from '../components/brand/Logo';
import LogoMark from '../components/brand/LogoMark';
import ColorModeToggle from '../components/brand/ColorModeToggle';

function envColor(env?: string): 'success' | 'warning' | 'info' {
  return env === 'UAT' ? 'warning' : env === 'DEV' ? 'info' : 'success';
}

const WIDTH = 240;
const COLLAPSED_WIDTH = 72;
const SIDEBAR_KEY = 'flownexus.sidebarCollapsed';
const TAGLINE = 'Connect APIs, databases and business workflows.';

function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
}

function DatabaseSwitcher({ profileId, selected, onChanged }: { profileId?: number; selected?: string; onChanged: () => void }) {
  const [dbs, setDbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = () => api.databases().then((r) => setDbs(r.databases)).catch(() => setDbs([]));
  useEffect(() => { void load(); }, [profileId]);
  const options = selected && !dbs.includes(selected) ? [selected, ...dbs] : dbs;
  const change = async (name: string) => {
    setBusy(true);
    try { await api.useDatabase(name); onChanged(); setMsg(`Switched to ${name}`); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not switch database'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Select size="small" value={selected ?? ''} disabled={busy} onOpen={() => void load()}
        onChange={(e) => void change(e.target.value)} inputProps={{ 'aria-label': 'Active database' }}
        sx={{ mr: 1.5, minWidth: 190, bgcolor: 'background.paper', color: 'text.primary' }}>
        {options.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
      </Select>
      <Snackbar open={!!msg} autoHideDuration={3500} onClose={() => setMsg('')} message={msg} />
    </>
  );
}
const NAV = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon /> },
  { to: '/connections', label: 'Database Connections', icon: <StorageIcon /> },
 // { to: '/sql-editor', label: 'SQL Editor', icon: <CodeIcon /> },
  { to: '/queries', label: 'Saved Queries', icon: <BookmarksIcon /> },
  { to: '/workflows', label: 'Workflow Manager', icon: <AccountTreeIcon /> },
//  { to: '/savings-wallet', label: 'Savings Wallet Workflow', icon: <SavingsIcon /> },
  { to: '/api-automation', label: 'API Automation', icon: <ApiIcon /> },
  { to: '/history', label: 'Execution History', icon: <HistoryIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
  { to: '/info', label: 'All-in-One Information', icon: <MenuBookIcon /> },
];

export default function AppLayout() {
  const { status, statuses, refresh } = useConnectionStatus();
  const mongo = statuses.find((x) => x.dbType === 'MONGODB' && x.active);
  const liveNames = statuses.map((x) => `${x.connectionName} (${x.dbType === 'MONGODB' ? 'MongoDB' : 'MySQL'} ${x.environment})${x.connected ? '' : ' - lost'}`).join(', ');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => {
    try { localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1'); } catch { /* ignore */ }
    return !c;
  });
  const width = collapsed ? COLLAPSED_WIDTH : WIDTH;
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar>
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'common.white' }}>
              <LogoMark size={30} title="" />
              <Typography variant="h6" component="h1" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>FlowNexus</Typography>
            </Box>
            <Typography variant="caption" noWrap sx={{ display: { xs: 'none', lg: 'block' }, opacity: 0.7 }}>{TAGLINE}</Typography>
          </Box>
          <ColorModeToggle />
          {status?.connected && (
            <DatabaseSwitcher profileId={status.profileId} selected={status.databaseName} onChanged={() => void refresh()} />
          )}
          {status?.connected ? (
            <Chip color={envColor(status.environment)} label={`${status.environment} · ${status.connectionName}`} sx={{ fontWeight: 600 }} />
          ) : (
            <Chip label={mongo ? 'MySQL: not connected' : 'Not connected'} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'common.white' }} />
          )}
          {mongo && (
            <Tooltip title={`Live connections: ${liveNames}`}>
              <Chip color={mongo.connected ? envColor(mongo.environment) : 'error'} label={`MongoDB · ${mongo.environment} · ${mongo.connectionName}`} sx={{ fontWeight: 600, ml: 1 }} />
            </Tooltip>
          )}
        </Toolbar>
      </AppBar>
      <Drawer variant="permanent" sx={{ width, flexShrink: 0, '& .MuiDrawer-paper': { width, boxSizing: 'border-box', overflowX: 'hidden', transition: (t) => t.transitions.create('width', { duration: t.transitions.duration.shortest }) } }}>
        <Toolbar sx={{ justifyContent: 'center' }}>
          {collapsed ? <LogoMark size={32} /> : <Logo markSize={30} fontSize="1.2rem" />}
        </Toolbar>
        <List component="nav" aria-label="main navigation">
          {NAV.map((n) => (
            <Tooltip key={n.to} title={collapsed ? n.label : ''} placement="right">
              <ListItemButton component={NavLink} to={n.to} end={n.to === '/'} aria-label={n.label}
                sx={{ justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 0 : 2,
                  '&.active': { bgcolor: 'action.selected', borderRight: 3, borderColor: 'primary.main', fontWeight: 700 } }}>
                <ListItemIcon sx={{ minWidth: collapsed ? 0 : 40, justifyContent: 'center' }}>{n.icon}</ListItemIcon>
                {!collapsed && <ListItemText primary={n.label} />}
              </ListItemButton>
            </Tooltip>
          ))}
        </List>
        <Box sx={{ mt: 'auto', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end', p: 1 }}>
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <IconButton onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Drawer>
      <Box component="main" sx={{ flex: 1, p: 3, minWidth: 0 }}>
        <Toolbar />
        <Outlet />
      </Box>
    </Box>
  );
}
