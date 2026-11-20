import { useState } from 'react';
import { AppBar, Box, Chip, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Tooltip, Typography } from '@mui/material';
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
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import Logo from '../components/brand/Logo';
import { APP_ATTRIBUTION, APP_NAME, APP_SUBTITLE, APP_TAGLINE } from '../brand';
import LogoMark from '../components/brand/LogoMark';
import ColorModeToggle from '../components/brand/ColorModeToggle';
import DatabaseSelect from '../components/DatabaseSelect';
import { envColor, envLabel } from '../utils/environments';

const WIDTH = 240;
const COLLAPSED_WIDTH = 72;
const SIDEBAR_KEY = 'dbutility.sidebarCollapsed';

function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === '1'; } catch { return false; }
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: <DashboardIcon /> },
  { to: '/connections', label: 'Database Connections', icon: <StorageIcon /> },
 // { to: '/sql-editor', label: 'SQL Editor', icon: <CodeIcon /> },
  { to: '/queries', label: 'Queries Manager', icon: <BookmarksIcon /> },
  { to: '/workflows', label: 'Workflow Manager', icon: <AccountTreeIcon /> },
//  { to: '/savings-wallet', label: 'Savings Wallet Workflow', icon: <SavingsIcon /> },
  { to: '/api-automation', label: 'API Manager', icon: <ApiIcon /> },
  { to: '/history', label: 'Execution History', icon: <HistoryIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
  { to: '/info', label: 'All-in-One Information', icon: <MenuBookIcon /> },
];

export default function AppLayout() {
  const { status, statuses, refresh } = useConnectionStatus();
  const location = useLocation();
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, color: 'common.white' }}>
              <LogoMark size={30} title="" />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" component="h1" noWrap sx={{ fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{APP_NAME}</Typography>
                <Typography variant="caption" component="p" noWrap sx={{ m: 0, opacity: 0.75, lineHeight: 1.1, display: { xs: 'none', sm: 'block' } }}>{APP_SUBTITLE}</Typography>
              </Box>
            </Box>
            <Typography variant="caption" noWrap sx={{ display: { xs: 'none', lg: 'block' }, opacity: 0.7, fontStyle: 'italic' }}>{APP_TAGLINE}</Typography>
          </Box>
          <ColorModeToggle />
          {status?.connected && (
            <Box sx={{ display: { xs: 'none', md: 'block' }, mr: 1.5 }}>
              <DatabaseSelect dbType="MYSQL" profileId={status.profileId} selected={status.databaseName} onChanged={() => void refresh()} onBar />
            </Box>
          )}
          {status?.connected ? (
            <Chip color={envColor(status.environment)} label={`${envLabel(status.environment)} · ${status.connectionName}`} sx={{ fontWeight: 600 }} />
          ) : (
            <Chip label={mongo ? 'MySQL: not connected' : 'Not connected'} sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'common.white' }} />
          )}
          {mongo && (
            <Box sx={{ display: 'flex', alignItems: 'center', ml: 1.5, gap: 1.5 }}>
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <DatabaseSelect dbType="MONGODB" profileId={mongo.profileId} selected={mongo.databaseName} onChanged={() => void refresh()} onBar />
              </Box>
              <Tooltip title={`Live connections: ${liveNames}`}>
                <Chip color={mongo.connected ? envColor(mongo.environment) : 'error'} label={`MongoDB · ${envLabel(mongo.environment)} · ${mongo.connectionName}`} sx={{ fontWeight: 600 }} />
              </Tooltip>
            </Box>
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
      <Box component="main" sx={{ flex: 1, p: 3, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Toolbar />
        <Box key={location.pathname} className="page-enter" sx={{ flex: 1 }}><Outlet /></Box>
        <Box component="footer" sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider', textAlign: 'center' }}>
          <Typography variant="caption" color="text.secondary">{APP_NAME} · {APP_ATTRIBUTION}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
