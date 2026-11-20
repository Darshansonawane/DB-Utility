import { Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import type { ApiCondition, ApiStepOptions } from '../types';

export const DEFAULT_OPTIONS: ApiStepOptions = { waitBeforeSeconds: 0, pollIntervalSeconds: 5, pollTimeoutSeconds: 300, maxAttempts: 1, until: [], assertions: [] };
const OPS = ['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'EXISTS', 'NOT_EXISTS', 'GREATER_THAN', 'LESS_THAN', 'MATCHES'];

function ConditionRows({ title, hint, rows, onChange }: { title: string; hint: string; rows: ApiCondition[]; onChange: (r: ApiCondition[]) => void }) {
  const upd = (i: number, p: Partial<ApiCondition>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...p } : r)));
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="caption" color="text.secondary">{hint}</Typography>
      {rows.map((c, i) => (
        <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 1 }}>
          <TextField size="small" select label="Check" value={c.source} sx={{ minWidth: 110 }} onChange={(e) => upd(i, { source: e.target.value as ApiCondition['source'] })}>
            <MenuItem value="BODY">Body</MenuItem><MenuItem value="STATUS">Status</MenuItem><MenuItem value="HEADER">Header</MenuItem>
          </TextField>
          <TextField size="small" label={c.source === 'HEADER' ? 'Header name' : 'JSON path'} disabled={c.source === 'STATUS'} value={c.path ?? ''}
            placeholder={c.source === 'BODY' ? 'data.status' : ''} onChange={(e) => upd(i, { path: e.target.value })} />
          <TextField size="small" select label="Operator" value={c.operator} sx={{ minWidth: 150 }} onChange={(e) => upd(i, { operator: e.target.value })}>
            {OPS.map((o) => <MenuItem key={o} value={o}>{o.replace('_', ' ').toLowerCase()}</MenuItem>)}
          </TextField>
          <TextField size="small" fullWidth label="Value" disabled={c.operator === 'EXISTS' || c.operator === 'NOT_EXISTS'} value={c.value ?? ''} onChange={(e) => upd(i, { value: e.target.value })} />
          <IconButton aria-label={`remove ${title} row`} onClick={() => onChange(rows.filter((_, k) => k !== i))}><DeleteIcon fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Button size="small" startIcon={<AddIcon />} onClick={() => onChange([...rows, { source: 'BODY', path: '', operator: 'EQUALS', value: '' }])}>Add condition</Button>
    </Box>
  );
}

/** Wait / poll / assert settings for one API step. Shared by API workflows and DB workflows. */
export default function ApiStepOptionsEditor({ value, onChange, sql }: { value: ApiStepOptions; onChange: (v: ApiStepOptions) => void; sql?: boolean }) {
  const set = (p: Partial<ApiStepOptions>) => onChange({ ...value, ...p });
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Number(v)));
  return (
    <Stack spacing={1.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField size="small" type="number" label="Wait before (s)" value={value.waitBeforeSeconds} onChange={(e) => set({ waitBeforeSeconds: num(e.target.value) })} helperText="Pause before the call" />
        <TextField size="small" type="number" label="Max attempts" value={value.maxAttempts} onChange={(e) => set({ maxAttempts: num(e.target.value) })} helperText={sql ? "Retries until a row exists" : "1 = no retry/poll"} />
        <TextField size="small" type="number" label="Poll every (s)" value={value.pollIntervalSeconds} onChange={(e) => set({ pollIntervalSeconds: num(e.target.value) })} helperText="Gap between attempts" />
        <TextField size="small" type="number" label="Give up after (s)" value={value.pollTimeoutSeconds} onChange={(e) => set({ pollTimeoutSeconds: num(e.target.value) })} helperText="Overall poll timeout" />
      </Stack>
      {!sql && (
        <>
      <ConditionRows title="Keep polling until" hint="The step repeats until the call succeeds and all of these hold, or it gives up (attempts / timeout). Empty = accept the first good response."
        rows={value.until} onChange={(until) => set({ until, maxAttempts: until.length > 0 && value.maxAttempts <= 1 ? 30 : value.maxAttempts })} />
      <ConditionRows title="Then assert" hint="Checked on the accepted response; any failure fails the step."
        rows={value.assertions} onChange={(assertions) => set({ assertions })} />
        </>
      )}
    </Stack>
  );
}
