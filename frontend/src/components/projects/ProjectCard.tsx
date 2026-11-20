import { useState } from 'react';
import { Box, Card, CardActionArea, Chip, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FolderIcon from '@mui/icons-material/Folder';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import type { Project } from '../../types';
import { timeAgo } from '../../utils/time';

/** Level 1: a project (application, product or business domain). */
export default function ProjectCard({ project, index = 0, over, dropProps, onOpen, onRename, onDelete }: {
  project: Project; index?: number; over?: boolean; dropProps?: Record<string, unknown>;
  onOpen: () => void; onRename: () => void; onDelete: () => void;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <Card className="fade-up hover-lift" style={{ '--i': index } as React.CSSProperties} {...dropProps}
      sx={{ position: 'relative', outline: over ? '2px solid' : 'none', outlineColor: 'primary.main', bgcolor: over ? 'action.hover' : undefined }}>
      <CardActionArea onClick={onOpen} aria-label={`open project ${project.name}`} sx={{ p: 2, display: 'block' }}>
        <Stack direction="row" spacing={1.5} alignItems="flex-start">
          <Box sx={{ width: 44, height: 44, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: 'primary.contrastText', flexShrink: 0 }}>
            <FolderSpecialIcon />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1, pr: 3 }}>
            <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }} title={project.name}>{project.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {project.description || 'No description'}
            </Typography>
          </Box>
        </Stack>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Chip size="small" icon={<FolderIcon />} label={`${project.folderCount} folder${project.folderCount === 1 ? '' : 's'}`} />
          <Chip size="small" icon={<AccountTreeIcon />} label={`${project.workflowCount} workflow${project.workflowCount === 1 ? '' : 's'}`} />
          {project.updatedAt && <Typography variant="caption" color="text.secondary">Updated {timeAgo(project.updatedAt)}</Typography>}
        </Stack>
      </CardActionArea>
      <IconButton size="small" aria-label={`actions for project ${project.name}`} onClick={(e) => setMenu(e.currentTarget)} sx={{ position: 'absolute', top: 8, right: 8 }}><MoreVertIcon fontSize="small" /></IconButton>
      <Menu open={!!menu} anchorEl={menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setMenu(null); onOpen(); }}>Open</MenuItem>
        <MenuItem onClick={() => { setMenu(null); onRename(); }}>Rename / edit</MenuItem>
        <MenuItem sx={{ color: 'error.main' }} onClick={() => { setMenu(null); onDelete(); }}>Delete…</MenuItem>
      </Menu>
    </Card>
  );
}
