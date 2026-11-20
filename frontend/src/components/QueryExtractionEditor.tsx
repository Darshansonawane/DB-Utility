import { Box, Button, Checkbox, FormControlLabel, IconButton, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import type { Folder, QueryExtraction } from '../types';
import { FolderSelect } from './folders/FolderPicker';

/** "Save from the result row into variables": runs automatically after every successful run of the query. */
export default function QueryExtractionEditor({ value, onChange, folders }: { value: QueryExtraction[]; onChange: (v: QueryExtraction[]) => void; folders: Folder[] }) {
  const upd = (i: number, p: Partial<QueryExtraction>) => onChange(value.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Save result values as variables</Typography>
      <Typography variant="caption" color="text.secondary">After each run, the chosen columns of the first row are stored as variables and can be used as {'{{name}}'} in any API request, query or workflow.</Typography>
      {value.map((x, i) => (
        <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center">
          <TextField size="small" label="Result column" value={x.column} onChange={(e) => upd(i, { column: e.target.value })} sx={{ minWidth: 170 }} placeholder="id" />
          <TextField size="small" label="Variable name" value={x.variable} onChange={(e) => upd(i, { variable: e.target.value })} sx={{ minWidth: 200 }} placeholder="savingsWalletDetailsId" />
          <Box sx={{ minWidth: 200 }}><FolderSelect folders={folders} label="Save in folder" noneLabel="Unfiled" value={x.folderId} onChange={(id) => upd(i, { folderId: id || null })} /></Box>
          <FormControlLabel label="Secret" control={<Checkbox checked={x.secret} onChange={(e) => upd(i, { secret: e.target.checked })} />} />
          <IconButton aria-label="remove extraction" onClick={() => onChange(value.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Box><Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...value, { variable: '', column: '', secret: false, folderId: null }])}>Add variable</Button></Box>
    </Stack>
  );
}
