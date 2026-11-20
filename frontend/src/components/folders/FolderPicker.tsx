import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import type { Folder } from '../../types';
import { childrenOf, folderPaths, UNFILED } from './folderUtils';

/** Drop-down used inside forms to put an item into a folder. */
export function FolderSelect({ folders, value, onChange, label = 'Folder', noneLabel = 'Unfiled (top level)', disabled }: {
  folders: Folder[]; value: number | null | undefined; onChange: (id: number) => void; label?: string; noneLabel?: string; disabled?: boolean;
}) {
  const paths = folderPaths(folders);
  const items = [...folders].sort((a, b) => (paths.get(a.id) ?? '').localeCompare(paths.get(b.id) ?? '', undefined, { sensitivity: 'base' }));
  return (
    <TextField size="small" select fullWidth label={label} value={value ?? 0} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
      <MenuItem value={UNFILED}>{noneLabel}</MenuItem>
      {items.map((f) => <MenuItem key={f.id} value={f.id}>{paths.get(f.id)}</MenuItem>)}
    </TextField>
  );
}

function PickNode({ folders, parentId, depth, selected, onSelect, disabled }: {
  folders: Folder[]; parentId: number; depth: number; selected: number; onSelect: (id: number) => void; disabled: Set<number>;
}) {
  return (
    <>
      {childrenOf(folders, parentId).map((f) => (
        <Box key={f.id}>
          <ListItemButton dense selected={selected === f.id} disabled={disabled.has(f.id)} onClick={() => onSelect(f.id)} sx={{ pl: 2 + depth * 2.5 }}>
            <ListItemIcon sx={{ minWidth: 32 }}>{selected === f.id ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}</ListItemIcon>
            <ListItemText primary={f.name} />
          </ListItemButton>
          <PickNode folders={folders} parentId={f.id} depth={depth + 1} selected={selected} onSelect={onSelect} disabled={disabled} />
        </Box>
      ))}
    </>
  );
}

/** "Move to…" dialog. `disabled` lists folders that cannot be chosen (for example the folder being moved and its subfolders). */
export default function FolderPicker({ open, title, folders, current, disabled, onPick, onClose }: {
  open: boolean; title: string; folders: Folder[]; current?: number; disabled?: Set<number>; onPick: (folderId: number) => void; onClose: () => void;
}) {
  const [sel, setSel] = useState<number>(current ?? UNFILED);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth TransitionProps={{ onEnter: () => setSel(current ?? UNFILED) }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List dense disablePadding>
          <ListItemButton dense selected={sel === UNFILED} onClick={() => setSel(UNFILED)}>
            <ListItemIcon sx={{ minWidth: 32 }}><FolderOpenIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Unfiled (top level)" />
          </ListItemButton>
          <PickNode folders={folders} parentId={0} depth={0} selected={sel} onSelect={setSel} disabled={disabled ?? new Set()} />
        </List>
        {folders.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>No folders yet. Create one in the folder panel first.</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onPick(sel)} disabled={sel === (current ?? UNFILED)}>Move here</Button>
      </DialogActions>
    </Dialog>
  );
}
