import { Autocomplete, Box, Button, Checkbox, FormControlLabel, IconButton, Stack, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import type { QueryExtraction } from '../../types';

/**
 * "Save to variable" for one workflow step: takes a column of the step's first result row and stores it as a variable, so any later step
 * can use it as {{name}}. `columns` are offered once the step has been tested in the editor.
 */
export default function StepVariableSaves({ value, onChange, columns }: { value: QueryExtraction[]; onChange: (v: QueryExtraction[]) => void; columns: string[] }) {
  const upd = (i: number, p: Partial<QueryExtraction>) => onChange(value.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <Stack spacing={1}>
      {value.map((x, i) => (
        <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center">
          <Autocomplete freeSolo size="small" options={columns} inputValue={x.column} onInputChange={(_, v) => upd(i, { column: v })} sx={{ minWidth: 240 }}
            renderInput={(p) => <TextField {...p} label="Result column (first row)" placeholder="contribution_date" />} />
          <TextField size="small" label="Save as variable" value={x.variable} onChange={(e) => upd(i, { variable: e.target.value })} sx={{ minWidth: 240 }} placeholder="contributionDate" />
          <FormControlLabel label="Secret" control={<Checkbox checked={x.secret} onChange={(e) => upd(i, { secret: e.target.checked })} />} />
          <IconButton aria-label="remove variable" onClick={() => onChange(value.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Box><Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...value, { variable: '', column: '', secret: false, folderId: null }])}>Save a value to a variable</Button></Box>
    </Stack>
  );
}
