import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Paper, Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InboxIcon from '@mui/icons-material/Inbox';
import { api, errMsg } from '../../services/api';
import type { Folder, FolderKind } from '../../types';
import FolderPicker from './FolderPicker';
import { ALL, childrenOf, subtreeIds, UNFILED } from './folderUtils';

export function useFolders(kind: FolderKind) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try { setFolders(await api.folders(kind)); setError(null); } catch (e) { setError(errMsg(e)); }
  }, [kind]);
  useEffect(() => { void reload(); }, [reload]);
  return { folders, reload, error };
}

export function NameDialog({ title, initial, onClose, onSave }: { title: string; initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth size="small" label="Folder name" value={name} sx={{ mt: 1 }} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSave(name.trim()); }} />
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button variant="contained" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save</Button></DialogActions>
    </Dialog>
  );
}

function Node({ folders, parentId, depth, selected, onSelect, counts, expanded, toggle }: {
  folders: Folder[]; parentId: number; depth: number; selected: number; onSelect: (id: number) => void; counts: Record<number, number>;
  expanded: Set<number>; toggle: (id: number) => void;
}) {
  return (
    <>
      {childrenOf(folders, parentId).map((f) => {
        const kids = childrenOf(folders, f.id);
        const open = expanded.has(f.id);
        return (
          <Box key={f.id}>
            <ListItemButton dense selected={selected === f.id} onClick={() => onSelect(f.id)} sx={{ pl: 1 + depth * 2 }} aria-label={`folder ${f.name}`}>
              <IconButton size="small" aria-label={open ? 'collapse' : 'expand'} sx={{ visibility: kids.length ? 'visible' : 'hidden', mr: 0.5 }}
                onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>
                {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
              </IconButton>
              <ListItemIcon sx={{ minWidth: 30 }}>{selected === f.id ? <FolderOpenIcon fontSize="small" color="primary" /> : <FolderIcon fontSize="small" />}</ListItemIcon>
              <ListItemText primary={f.name} primaryTypographyProps={{ noWrap: true, fontWeight: selected === f.id ? 700 : 400 }} />
              {counts[f.id] ? <Chip size="small" label={counts[f.id]} variant="outlined" /> : null}
            </ListItemButton>
            {open && <Node folders={folders} parentId={f.id} depth={depth + 1} selected={selected} onSelect={onSelect} counts={counts} expanded={expanded} toggle={toggle} />}
          </Box>
        );
      })}
    </>
  );
}

/**
 * Folder panel shared by Requests Storage, API Workflows, Variables and All-in-One Information: nested folders, create / rename /
 * move / delete. `counts` is the number of items per folder id (ALL = total, UNFILED = items outside any folder).
 */
export default function FolderTree({ title, kind, folders, selected, onSelect, onChanged, counts, itemLabel }: {
  title: string; kind: FolderKind; folders: Folder[]; selected: number; onSelect: (id: number) => void; onChanged: () => void;
  counts: Record<number, number>; itemLabel: string;
}) {
  const [dialog, setDialog] = useState<null | 'new-root' | 'new-sub' | 'rename'>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const current = folders.find((f) => f.id === selected);
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  useEffect(() => { // keep the path to the selected folder open
    if (!current) return;
    setExpanded((s) => {
      const n = new Set(s);
      let p = current.parentId;
      while (p !== 0) { n.add(p); p = folders.find((f) => f.id === p)?.parentId ?? 0; }
      return n;
    });
  }, [current, folders]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); setError(null); onChanged(); } catch (e) { setError(errMsg(e)); }
  };

  return (
    <Paper variant="outlined" sx={{ width: 290, flexShrink: 0, alignSelf: 'flex-start' }}>
      <Stack direction="row" alignItems="center" sx={{ px: 1.5, py: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{title}</Typography>
        <Tooltip title="New folder"><IconButton size="small" aria-label="new folder" onClick={() => setDialog('new-root')}><CreateNewFolderIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title={current ? `New subfolder in ${current.name}` : 'Select a folder first'}><span>
          <IconButton size="small" aria-label="new subfolder" disabled={!current} onClick={() => setDialog('new-sub')}><CreateNewFolderIcon fontSize="small" color={current ? 'primary' : 'inherit'} /></IconButton></span></Tooltip>
        <Tooltip title="Rename folder"><span><IconButton size="small" aria-label="rename folder" disabled={!current} onClick={() => setDialog('rename')}><DriveFileRenameOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Move folder"><span><IconButton size="small" aria-label="move folder" disabled={!current} onClick={() => setMoving(true)}><DriveFileMoveIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Delete folder"><span><IconButton size="small" aria-label="delete folder" disabled={!current}
          onClick={() => {
            if (current && window.confirm(`Delete folder "${current.name}" and its subfolders? The ${itemLabel} inside are not deleted: they move to Unfiled.`)) {
              void act(async () => { await api.deleteFolder(current.id); onSelect(ALL); });
            }
          }}><DeleteIcon fontSize="small" /></IconButton></span></Tooltip>
      </Stack>
      {error && <Alert severity="error" sx={{ mx: 1, mb: 1, py: 0 }} onClose={() => setError(null)}>{error}</Alert>}
      <List dense disablePadding sx={{ pb: 1 }}>
        <ListItemButton dense selected={selected === ALL} onClick={() => onSelect(ALL)} aria-label={`all ${itemLabel}`}>
          <ListItemIcon sx={{ minWidth: 30 }}><FolderSpecialIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={`All ${itemLabel}`} primaryTypographyProps={{ fontWeight: selected === ALL ? 700 : 400 }} />
          <Chip size="small" label={counts[ALL] ?? 0} variant="outlined" />
        </ListItemButton>
        <ListItemButton dense selected={selected === UNFILED} onClick={() => onSelect(UNFILED)} aria-label="unfiled">
          <ListItemIcon sx={{ minWidth: 30 }}><InboxIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Unfiled" primaryTypographyProps={{ fontWeight: selected === UNFILED ? 700 : 400 }} />
          <Chip size="small" label={counts[UNFILED] ?? 0} variant="outlined" />
        </ListItemButton>
        <Node folders={folders} parentId={0} depth={0} selected={selected} onSelect={onSelect} counts={counts} expanded={expanded} toggle={toggle} />
      </List>
      {dialog === 'new-root' && <NameDialog title="New folder" initial="" onClose={() => setDialog(null)}
        onSave={(n) => { setDialog(null); void act(async () => { const f = await api.createFolder(kind, 0, n); onSelect(f.id); }); }} />}
      {dialog === 'new-sub' && current && <NameDialog title={`New subfolder in ${current.name}`} initial="" onClose={() => setDialog(null)}
        onSave={(n) => { setDialog(null); void act(async () => { const f = await api.createFolder(kind, current.id, n); onSelect(f.id); }); }} />}
      {dialog === 'rename' && current && <NameDialog title="Rename folder" initial={current.name} onClose={() => setDialog(null)}
        onSave={(n) => { setDialog(null); void act(() => api.updateFolder(current.id, { name: n })); }} />}
      {moving && current && (
        <FolderPicker open title={`Move folder "${current.name}" to…`} folders={folders} current={current.parentId} disabled={subtreeIds(folders, current.id)}
          onClose={() => setMoving(false)} onPick={(id) => { setMoving(false); void act(() => api.updateFolder(current.id, { parentId: id })); }} />
      )}
    </Paper>
  );
}
