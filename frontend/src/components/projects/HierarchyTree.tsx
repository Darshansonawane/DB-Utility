import { useState } from 'react';
import { Box, Collapse, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, Typography } from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import HomeIcon from '@mui/icons-material/Home';
import type { Data } from './workflowHierarchy';
import { childFolders, workflowsUnder } from './workflowHierarchy';

type Drop = (projectId: number, folderId: number) => Record<string, unknown>;

function FolderNode({ data, projectId, parentId, depth, folderId, onSelect, drop, expanded, toggle }: {
  data: Data; projectId: number; parentId: number; depth: number; folderId: number; onSelect: (p: number, f: number) => void; drop: Drop;
  expanded: Set<number>; toggle: (id: number) => void;
}) {
  return (
    <>
      {childFolders(data, projectId, parentId).map((f) => {
        const kids = childFolders(data, projectId, f.id);
        const open = expanded.has(f.id);
        return (
          <Box key={f.id}>
            <ListItemButton dense selected={folderId === f.id} onClick={() => onSelect(projectId, f.id)} {...drop(projectId, f.id)} sx={{ pl: 2 + depth * 2, borderRadius: 1 }} aria-label={`tree folder ${f.name}`}>
              <ListItemIcon sx={{ minWidth: 26 }}>
                {kids.length > 0
                  ? <IconButton size="small" edge="start" aria-label={open ? `collapse ${f.name}` : `expand ${f.name}`} onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>{open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}</IconButton>
                  : (folderId === f.id ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />)}
              </ListItemIcon>
              <ListItemText primary={f.name} primaryTypographyProps={{ noWrap: true, variant: 'body2' }} />
              <Typography variant="caption" color="text.secondary">{workflowsUnder(data, f.id).length}</Typography>
            </ListItemButton>
            {kids.length > 0 && <Collapse in={open} unmountOnExit><FolderNode data={data} projectId={projectId} parentId={f.id} depth={depth + 1} folderId={folderId} onSelect={onSelect} drop={drop} expanded={expanded} toggle={toggle} /></Collapse>}
          </Box>
        );
      })}
    </>
  );
}

/** Collapsible Projects > Folders navigation. Drop workflows or folders on a node to move them there. */
export default function HierarchyTree({ data, projectId, folderId, onSelect, drop }: {
  data: Data; projectId: number; folderId: number; onSelect: (projectId: number, folderId: number) => void; drop: Drop;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openProjects, setOpenProjects] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleProject = (id: number) => setOpenProjects((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <List dense component="nav" aria-label="projects and folders" sx={{ p: 0.5 }}>
      <ListItemButton dense selected={projectId === 0} onClick={() => onSelect(0, 0)} sx={{ borderRadius: 1 }}>
        <ListItemIcon sx={{ minWidth: 30 }}><HomeIcon fontSize="small" /></ListItemIcon>
        <ListItemText primary="All projects" primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }} />
      </ListItemButton>
      {data.projects.map((p) => {
        const hasFolders = childFolders(data, p.id, 0).length > 0;
        const open = openProjects.has(p.id) || projectId === p.id;
        return (
          <Box key={p.id}>
            <ListItemButton dense selected={projectId === p.id && folderId === 0} onClick={() => onSelect(p.id, 0)} {...drop(p.id, 0)} sx={{ borderRadius: 1 }} aria-label={`tree project ${p.name}`}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                {hasFolders
                  ? <IconButton size="small" edge="start" aria-label={open ? `collapse ${p.name}` : `expand ${p.name}`} onClick={(e) => { e.stopPropagation(); toggleProject(p.id); }}>{open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}</IconButton>
                  : <FolderSpecialIcon fontSize="small" color="primary" />}
              </ListItemIcon>
              <Tooltip title={p.name} placement="right"><ListItemText primary={p.name} primaryTypographyProps={{ noWrap: true, variant: 'body2', fontWeight: 600 }} /></Tooltip>
              <Typography variant="caption" color="text.secondary">{p.workflowCount}</Typography>
            </ListItemButton>
            {hasFolders && <Collapse in={open} unmountOnExit><FolderNode data={data} projectId={p.id} parentId={0} depth={1} folderId={projectId === p.id ? folderId : 0} onSelect={onSelect} drop={drop} expanded={expanded} toggle={toggle} /></Collapse>}
          </Box>
        );
      })}
    </List>
  );
}
