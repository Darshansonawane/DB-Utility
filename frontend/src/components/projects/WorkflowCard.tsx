import { Box, Button, Card, Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import type { Workflow } from '../../types';
import { timeAgo } from '../../utils/time';
import LastRunBadge from './LastRunBadge';
import { WORKFLOW_DRAG } from './workflowHierarchy';

/** Level 3: a workflow. Name, description, step count, last execution; Run, Edit, Move and Delete. */
export default function WorkflowCard({ w, index = 0, path, usedIn, onRun, onEdit, onMove, onDuplicate, onDelete }: {
  w: Workflow; index?: number; path?: string; usedIn?: string[];
  onRun: () => void; onEdit: () => void; onMove: () => void; onDuplicate: () => void; onDelete: () => void;
}) {
  return (
    <Card className="fade-up" style={{ '--i': Math.min(index, 8) } as React.CSSProperties} draggable
      onDragStart={(e) => { e.dataTransfer.setData(WORKFLOW_DRAG, String(w.id)); e.dataTransfer.effectAllowed = 'move'; }}
      sx={{ p: 2, '&:hover': { boxShadow: 4 } }} data-testid={`workflow-${w.id}`}>
      <Stack direction="row" alignItems="flex-start" spacing={1.5}>
        <DragIndicatorIcon fontSize="small" sx={{ color: 'text.disabled', cursor: 'grab', mt: 0.5 }} aria-hidden />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{w.name}</Typography>
            <Chip size="small" label={`${w.steps.length} step${w.steps.length === 1 ? '' : 's'}`} />
            <LastRunBadge w={w} />
            {(usedIn?.length ?? 0) > 0 && (
              <Tooltip title={`Used in: ${usedIn!.join(', ')}`}><Chip size="small" color="secondary" variant="outlined" icon={<AccountTreeIcon />} label={`Used in ${usedIn!.length}`} /></Tooltip>
            )}
          </Stack>
          {path && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>{path}</Typography>}
          {w.description && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{w.description}</Typography>}
          {w.updatedAt && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>Updated {timeAgo(w.updatedAt)}</Typography>}
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" justifyContent="flex-end" sx={{ maxWidth: 260 }}>
          <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={onRun}>Run</Button>
          <Button size="small" onClick={onEdit}>Edit</Button>
          <Tooltip title="Move"><IconButton size="small" aria-label={`move ${w.name}`} onClick={onMove}><DriveFileMoveIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Duplicate"><IconButton size="small" aria-label={`duplicate ${w.name}`} onClick={onDuplicate}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="Delete"><IconButton size="small" color="error" aria-label={`delete ${w.name}`} onClick={onDelete}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
      </Stack>
    </Card>
  );
}
