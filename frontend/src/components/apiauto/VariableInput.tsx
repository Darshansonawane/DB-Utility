import { useEffect, useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { api } from '../../services/api';

let cache: { at: number; names: string[] } | null = null;

/** Variable names for pickers; cached for a few seconds so many inputs share one request. */
export function useVariableNames(): string[] {
  const [names, setNames] = useState<string[]>(cache?.names ?? []);
  useEffect(() => {
    if (cache && Date.now() - cache.at < 5000) { setNames(cache.names); return; }
    api.variables().then((v) => { const n = [...new Set(v.map((x) => x.name))].sort(); cache = { at: Date.now(), names: n }; setNames(n); }).catch(() => undefined);
  }, []);
  return names;
}

const BUILTINS = ['{{$uuid}}', '{{$timestamp}}', '{{$isoDate}}', '{{$randomInt(1,100)}}', '{{$randomString(8)}}', '{{$randomNumeric(10)}}'];

/** Free-text field that also offers the saved variables ({{name}}) and built-ins as suggestions. */
export default function VariableInput({ value, onChange, label, placeholder, helperText, size = 'small', disabled, extraNames = [] }: {
  value: string; onChange: (v: string) => void; label: string; placeholder?: string; helperText?: string; size?: 'small' | 'medium'; disabled?: boolean;
  /** more names to suggest, for example variables other steps of the workflow being edited will save */
  extraNames?: string[];
}) {
  const names = [...new Set([...useVariableNames(), ...extraNames.filter(Boolean)])].sort();
  return (
    <Autocomplete freeSolo size={size} disabled={disabled} options={[...names.map((n) => `{{${n}}}`), ...BUILTINS]} inputValue={value} value={value}
      onInputChange={(_, v) => onChange(v)} onChange={(_, v) => onChange(typeof v === 'string' ? v : '')} fullWidth
      renderInput={(p) => <TextField {...p} label={label} placeholder={placeholder} helperText={helperText} />} />
  );
}
