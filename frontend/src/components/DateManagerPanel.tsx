import { useMemo, useState } from 'react';
import { Alert, Box, Chip, FormControl, FormControlLabel, FormLabel, MenuItem, Paper, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { resolveDate, type DateSource } from '../utils/dates';

export interface ExistingDateOption { label: string; value: string }

interface Props {
  /** Dates currently in the database (read from fetched records). */
  existing: ExistingDateOption[];
  /** Captured once from the Step 1 schedule record for the current run; never overwritten by later choices. */
  originalScheduledDate: string | null;
  originalLabel?: string;
  onProposedChange?: (proposed: string | null, source: DateSource) => void;
  now?: Date;
}

const SOURCES: { value: DateSource; label: string }[] = [
  { value: 'TODAY', label: "Today's Date" },
  { value: 'PREVIOUS', label: 'Previous Date (yesterday)' },
  { value: 'ONE_MONTH_BACK', label: 'One Month Back' },
  { value: 'ORIGINAL', label: 'Original Scheduled Date' },
  { value: 'CUSTOM', label: 'Custom Date' },
];

/** Previews a proposed date. It never writes: write statements are pending schema confirmation. */
export default function DateManagerPanel({ existing, originalScheduledDate, originalLabel, onProposedChange, now }: Props) {
  const [source, setSource] = useState<DateSource>('TODAY');
  const [custom, setCustom] = useState('');
  const [existingIdx, setExistingIdx] = useState(0);

  const proposed = useMemo(() => resolveDate(source, { original: originalScheduledDate, custom, now }), [source, custom, originalScheduledDate, now]);
  const current = existing[existingIdx];

  const change = (s: DateSource, c = custom) => {
    setSource(s);
    onProposedChange?.(resolveDate(s, { original: originalScheduledDate, custom: c, now }), s);
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>Date management (preview)</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
        <FormControl>
          <FormLabel>Date source</FormLabel>
          <RadioGroup value={source} onChange={(e) => change(e.target.value as DateSource)}>
            {SOURCES.map((s) => (
              <FormControlLabel key={s.value} value={s.value} control={<Radio size="small" />} label={s.label}
                disabled={s.value === 'ORIGINAL' && !originalScheduledDate} />
            ))}
          </RadioGroup>
          {source === 'CUSTOM' && (
            <TextField type="date" size="small" label="Custom date" InputLabelProps={{ shrink: true }} value={custom}
              onChange={(e) => { setCustom(e.target.value); change('CUSTOM', e.target.value); }} sx={{ mt: 1 }} />
          )}
        </FormControl>
        <Stack spacing={2} sx={{ flex: 1 }}>
          <TextField select size="small" label="Existing database date" value={existing.length ? existingIdx : ''} disabled={!existing.length}
            onChange={(e) => setExistingIdx(Number(e.target.value))} helperText={existing.length ? undefined : 'Fetch details first: date columns from the results appear here.'}>
            {existing.map((o, i) => <MenuItem key={i} value={i}>{o.label}</MenuItem>)}
          </TextField>
          <Box>
            <Typography variant="caption" color="text.secondary">Existing</Typography>
            <Typography variant="h6" data-testid="existing-date">{current?.value ?? '-'}</Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Proposed</Typography>
            <Typography variant="h6" color="primary" data-testid="proposed-date">{proposed ?? '-'}</Typography>
            <Chip size="small" label={`Source: ${SOURCES.find((s) => s.value === source)!.label}`} />
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">Original scheduled date (captured for this run{originalLabel ? `: ${originalLabel}` : ''})</Typography>
            <Typography data-testid="original-date">{originalScheduledDate ?? 'not captured yet'}</Typography>
          </Box>
        </Stack>
      </Stack>
      <Alert severity="info" sx={{ mt: 2 }}>
        Preview only. The UPDATE statements for these date changes have not been supplied or confirmed yet, so nothing can be applied from here.
      </Alert>
    </Paper>
  );
}
