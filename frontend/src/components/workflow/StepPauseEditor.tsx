import { useState } from 'react';
import { Checkbox, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material';

export interface StepPause { waitSeconds: number; manualResume: boolean }

/** Optional hold before a step: wait a set time, and/or pause the run until someone resumes it. */
export default function StepPauseEditor({ value, onChange }: { value?: StepPause | null; onChange: (v: StepPause | null) => void }) {
  const secs = value?.waitSeconds ?? 0;
  const [unit, setUnit] = useState<'s' | 'm'>(secs > 0 && secs % 60 === 0 ? 'm' : 's');
  const shown = unit === 'm' ? secs / 60 : secs;
  const emit = (waitSeconds: number, manualResume: boolean) => onChange(waitSeconds > 0 || manualResume ? { waitSeconds, manualResume } : null);
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
      <TextField size="small" type="number" label="Wait before this step" sx={{ width: 190 }} value={secs === 0 ? '' : shown} placeholder="none"
        inputProps={{ min: 0 }} onChange={(e) => emit(Math.max(0, Math.round(Number(e.target.value) || 0)) * (unit === 'm' ? 60 : 1), value?.manualResume ?? false)} />
      <TextField size="small" select value={unit} sx={{ width: 120 }} inputProps={{ 'aria-label': 'wait unit' }}
        onChange={(e) => { const u = e.target.value as 's' | 'm'; setUnit(u); emit(u === 'm' ? Math.round(secs / 60) * 60 : secs, value?.manualResume ?? false); }}>
        <MenuItem value="s">seconds</MenuItem><MenuItem value="m">minutes</MenuItem>
      </TextField>
      <FormControlLabel label="Pause until I resume" control={<Checkbox checked={value?.manualResume ?? false} onChange={(e) => emit(secs, e.target.checked)} />} />
    </Stack>
  );
}
