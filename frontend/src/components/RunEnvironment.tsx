import { useEffect, useState } from 'react';
import { Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { api } from '../services/api';

const KEY = 'dbutility.runEnv';
/** In the order a change moves through them. */
export const RUN_ENVIRONMENTS = [{ value: 'DEV', label: 'Dev' }, { value: 'QA', label: 'QA' }, { value: 'STAGING', label: 'Staging' }] as const;

// one shared value, so every picker on screen shows the same environment
let current: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(v: string) => void>();
const publish = (v: string) => { current = v; listeners.forEach((l) => l(v)); };

function load(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      let saved = '';
      try { saved = localStorage.getItem(KEY) ?? ''; } catch { /* storage unavailable */ }
      try {
        const r = await api.activeEnvironment();
        if (saved && saved !== r.environment) { const s = await api.setActiveEnvironment(saved); publish(s.environment); } // the server forgot it (restart): put it back
        else publish(r.environment);
      } catch { publish(saved); }
    })();
  }
  return loading;
}

/** The environment runs use ("Dev", "QA" or "Staging"): variables defined for that environment are the ones that apply. */
export function useRunEnvironment(): [string, (v: string) => Promise<void>] {
  const [value, setValue] = useState(current ?? '');
  useEffect(() => { listeners.add(setValue); void load(); return () => { listeners.delete(setValue); }; }, []);
  const set = async (v: string) => {
    const r = await api.setActiveEnvironment(v);
    try { localStorage.setItem(KEY, r.environment); } catch { /* ignore */ }
    publish(r.environment);
  };
  return [value, set];
}

/** "Run in: Dev | QA | Staging": picked before running; each run keeps the environment it started with. */
export default function RunEnvironment({ label = 'Run in' }: { label?: string }) {
  const [env, setEnv] = useRunEnvironment();
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Tooltip title="Variables set for this environment (for example the base URL) are used when you run">
        <ToggleButtonGroup size="small" exclusive color="primary" value={env} aria-label="run environment" onChange={(_, v) => { if (v !== null) void setEnv(v); }}>
          {RUN_ENVIRONMENTS.map((e) => <ToggleButton key={e.value} value={e.value} aria-label={`environment ${e.label}`} sx={{ px: 1.5 }}>{e.label}</ToggleButton>)}
        </ToggleButtonGroup>
      </Tooltip>
    </Stack>
  );
}
