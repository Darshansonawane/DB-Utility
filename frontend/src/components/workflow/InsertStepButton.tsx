import { useState } from 'react';
import { Box, Divider, IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

export type StepKind = 'QUERY' | 'API_REQUEST' | 'WORKFLOW';

/** A thin divider with a "+" in the middle: add a step at this position. */
export default function InsertStepButton({ position, onPick }: { position: number; onPick: (kind: StepKind) => void }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const pick = (k: StepKind) => { setEl(null); onPick(k); };
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, my: -0.5 }}>
      <Divider sx={{ flex: 1 }} />
      <Tooltip title={`Add a step at position ${position}`}>
        <IconButton size="small" aria-label={`add step at position ${position}`} onClick={(e) => setEl(e.currentTarget)}
          sx={{ border: 1, borderColor: 'divider', p: 0.25, color: 'primary.main' }}><AddIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Divider sx={{ flex: 1 }} />
      <Menu anchorEl={el} open={!!el} onClose={() => setEl(null)}>
        <MenuItem onClick={() => pick('QUERY')}>DB query</MenuItem>
        <MenuItem onClick={() => pick('API_REQUEST')}>API request</MenuItem>
        <MenuItem onClick={() => pick('WORKFLOW')}>Workflow</MenuItem>
      </Menu>
    </Box>
  );
}
