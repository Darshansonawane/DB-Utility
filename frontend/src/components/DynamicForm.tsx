import { FormControlLabel, Stack, Switch, TextField } from '@mui/material';
import type { QueryParameter } from '../types';

interface Props {
  parameters: QueryParameter[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
  /** Per-field helper text (e.g. where an automatically populated value came from). */
  hints?: Record<string, string>;
}

/**
 * The single form engine for every saved query and workflow: fields are generated purely from parameter
 * definitions (type -> control). No per-query components exist.
 */
export default function DynamicForm({ parameters, values, onChange, disabled, hints }: Props) {
  const set = (name: string, v: string) => onChange({ ...values, [name]: v });
  if (parameters.length === 0) return null;
  return (
    <Stack spacing={2}>
      {parameters.map((p) => {
        const common = {
          label: p.label,
          required: p.required,
          disabled,
          fullWidth: true,
          size: 'small' as const,
          helperText: hints?.[p.name],
          value: values[p.name] ?? '',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(p.name, e.target.value),
          inputProps: { 'data-testid': `field-${p.name}`, 'data-type': p.type },
        };
        const hasVar = (values[p.name] ?? '').includes('{{');
        if (hasVar) return <TextField key={p.name} {...common} type="text" helperText={hints?.[p.name] ?? 'Variable: resolved when the query runs'} />;
        switch (p.type) {
          case 'DATE':
            return <TextField key={p.name} {...common} type="date" InputLabelProps={{ shrink: true }} />;
          case 'DATETIME':
            return <TextField key={p.name} {...common} type="datetime-local" InputLabelProps={{ shrink: true }} />;
          case 'INTEGER':
            return <TextField key={p.name} {...common} type="text" inputProps={{ ...common.inputProps, inputMode: 'numeric', pattern: '-?[0-9]*' }} />;
          case 'DECIMAL':
            return <TextField key={p.name} {...common} type="text" inputProps={{ ...common.inputProps, inputMode: 'decimal' }} />;
          case 'BOOLEAN':
            return (
              <FormControlLabel
                key={p.name}
                disabled={disabled}
                label={`${p.label}${p.required ? ' *' : ''}`}
                control={<Switch checked={(values[p.name] ?? '') === 'true'} onChange={(e) => set(p.name, e.target.checked ? 'true' : 'false')} inputProps={{ 'aria-label': p.label }} />}
              />
            );
          default:
            return <TextField key={p.name} {...common} type="text" />;
        }
      })}
    </Stack>
  );
}

