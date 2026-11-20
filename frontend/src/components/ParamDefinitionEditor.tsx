import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VariableInput from './apiauto/VariableInput';
import type { ParamType, QueryParameter } from '../types';

const TYPES: ParamType[] = ['STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN'];

interface Props { parameters: QueryParameter[]; onChange: (p: QueryParameter[]) => void }

/** Edits the i-th "?" placeholder definitions: these drive the generated forms. */
export default function ParamDefinitionEditor({ parameters, onChange }: Props) {
  const upd = (i: number, patch: Partial<QueryParameter>) => onChange(parameters.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <Stack spacing={1.5}>
      {parameters.map((p, i) => (
        <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems="center">
          <TextField size="small" label={`#${i + 1} name`} value={p.name} onChange={(e) => upd(i, { name: e.target.value })} sx={{ minWidth: 150 }} />
          <TextField size="small" label="Label" value={p.label} onChange={(e) => upd(i, { label: e.target.value })} sx={{ minWidth: 170 }} />
          <TextField size="small" select label="Type" value={p.type} onChange={(e) => upd(i, { type: e.target.value as ParamType })} sx={{ minWidth: 130 }}>
            {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <Box sx={{ minWidth: 260 }}><VariableInput label="Default / mapped variable" value={p.defaultValue ?? ''} placeholder="value or {{variable}}" onChange={(v) => upd(i, { defaultValue: v })} /></Box>
          <FormControlLabel control={<Checkbox checked={p.required} onChange={(e) => upd(i, { required: e.target.checked })} />} label="Required" />
          <IconButton aria-label="remove parameter" onClick={() => onChange(parameters.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
    </Stack>
  );
}
