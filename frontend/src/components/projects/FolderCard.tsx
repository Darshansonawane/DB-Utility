import { useState } from 'react';
import { Box, IconButton, Menu, MenuItem, Paper, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { Folder } from '../../types';
import { FOLDER_DRAG } from './workflowHierarchy';

/** Level 2: a folder (nested folders allowed). Drag it onto another folder to move it; drop workflows on it. */
export default function FolderCard({ folder, workflowCount, subfolderCount, over, dropProps, onOpen, onRename, onMove, onDelete, path }: {
  folder: Folder; workflowCount: number; subfolderCount: number; over?: boolean; dropProps?: Record<string, unknown>;
  onOpen: () => void; onRename: () => void; onMove: () => void; onDelete: () => void; path?: string;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <Paper variant="outlined" draggable {...dropProps} onDragStart={(e) => { e.dataTransfer.setData(FOLDER_DRAG, String(folder.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={onOpen} role="button" aria-label={`open folder ${folder.name}`} className="hover-lift"
      sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, cursor: 'pointer', borderRadius: 2, borderColor: over ? 'primary.main' : undefined, bgcolor: over ? 'action.hover' : 'background.paper' }}>
      <FolderIcon sx={{ fontSize: 38, color: 'warning.main' }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600 }} title={folder.name}>{folder.name}</Typography>
        <Typography variant="caption" color="text.secondary" noWrap component="div">
          {path ? `${path} · ` : ''}{workflowCount} workflow{workflowCount === 1 ? '' : 's'}{subfolderCount ? ` · ${subfolderCount} folder${subfolderCount === 1 ? '' : 's'}` : ''}
        </Typography>
      </Box>
      <IconButton size="small" aria-label={`actions for folder ${folder.name}`} onClick={(e) => { e.stopPropagation(); setMenu(e.currentTarget); }}><MoreVertIcon fontSize="small" /></IconButton>
      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => { setMenu(null); onOpen(); }}>Open</MenuItem>
        <MenuItem onClick={() => { setMenu(null); onRename(); }}>Rename</MenuItem>
        <MenuItem onClick={() => { setMenu(null); onMove(); }}>Move to…</MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => { setMenu(null); onDelete(); }}>Delete…</MenuItem>
      </Menu>
    </Paper>
  );
}
