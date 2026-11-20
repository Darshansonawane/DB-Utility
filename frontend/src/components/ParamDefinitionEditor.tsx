import { useEffect, useRef, useState } from 'react';
import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import VariableInput from './apiauto/VariableInput';
import type { ParamType, QueryParameter } from '../types';

const TYPES: ParamType[] = ['STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN'];

export type ParamMode = 'RUNTIME' | 'AUTOMATIC';

/**
 * Runtime: the value is typed in by hand when the query or workflow runs. Automatic: the value comes from a variable ({{name}}),
 * which an API response, another query or a workflow step fills in. The variable reference is stored in the parameter's
 * defaultValue field, which the engine resolves at run time, so no stored literal value is involved.
 */
export function paramMode(p: QueryParameter): ParamMode {
  return (p.defaultValue ?? '').trim() ? 'AUTOMATIC' : 'RUNTIME';
}

interface Props { parameters: QueryParameter[]; onChange: (p: QueryParameter[]) => void }

/**
 * Edits the i-th "?" placeholder definitions: these drive the generated forms. Every parameter is either supplied
 * manually at <b>Runtime</b> or is <b>Automatic</b>: taken from a variable that an API or another query fills in.
 */
export default function ParamDefinitionEditor({ parameters, onChange }: Props) {
  const [forced, setForced] = useState<Record<number, ParamMode>>({});
  const stash = useRef<Record<number, string>>({});
  // a new list of parameters (for example after Detect parameters) starts from what each one actually holds
  const count = parameters.length;
  useEffect(() => { setForced({}); stash.current = {}; }, [count]);

  const upd = (i: number, patch: Partial<QueryParameter>) => onChange(parameters.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  const modeOf = (p: QueryParameter, i: number): ParamMode => forced[i] ?? paramMode(p);
  const setMode = (i: number, m: ParamMode) => {
    const p = parameters[i];
    setForced((f) => ({ ...f, [i]: m }));
    if (m === 'RUNTIME') {
      if ((p.defaultValue ?? '').trim()) stash.current[i] = p.defaultValue ?? '';
      upd(i, { defaultValue: null });
    } else if (stash.current[i]) {
      upd(i, { defaultValue: stash.current[i] });
    }
  };

  return (
    <Stack spacing={1.5}>
      {parameters.map((p, i) => {
        const mode = modeOf(p, i);
        return (
          <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'flex-start' }}>
            <TextField size="small" label={`#${i + 1} name`} value={p.name} onChange={(e) => upd(i, { name: e.target.value })} sx={{ minWidth: 150 }} />
            <TextField size="small" label="Label" value={p.label} onChange={(e) => upd(i, { label: e.target.value })} sx={{ minWidth: 170 }} />
            <TextField size="small" select label="Type" value={p.type} onChange={(e) => upd(i, { type: e.target.value as ParamType })} sx={{ minWidth: 130 }}>
              {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </TextField>
            <Tooltip title="Runtime: entered by hand. Automatic: from a variable.">
              <ToggleButtonGroup size="small" exclusive value={mode} aria-label={`value source of parameter ${i + 1}`} onChange={(_, v: ParamMode | null) => v && setMode(i, v)} sx={{ height: 40 }}>
                <ToggleButton value="RUNTIME" aria-label={`parameter ${i + 1} runtime`}>Runtime</ToggleButton>
                <ToggleButton value="AUTOMATIC" aria-label={`parameter ${i + 1} automatic`}>Automatic</ToggleButton>
              </ToggleButtonGroup>
            </Tooltip>
            <Box sx={{ minWidth: 260, flex: 1 }}>
              {mode === 'AUTOMATIC'
                ? <VariableInput label="Variable" value={p.defaultValue ?? ''} placeholder="{{variable}}" onChange={(v) => upd(i, { defaultValue: v })}
                  helperText={(p.defaultValue ?? '').trim() && !(p.defaultValue ?? '').includes('{{') ? 'Use {{name}}' : undefined} />
                : null}
            </Box>
            <FormControlLabel control={<Checkbox checked={p.required} onChange={(e) => upd(i, { required: e.target.checked })} />} label="Required" sx={{ mt: { md: 0.25 } }} />
            <IconButton aria-label="remove parameter" onClick={() => onChange(parameters.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton>
          </Stack>
        );
      })}
    </Stack>
  );
}
