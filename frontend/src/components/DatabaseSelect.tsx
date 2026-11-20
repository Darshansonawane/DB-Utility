import { useCallback, useEffect, useState } from 'react';
import { Autocomplete, Box, CircularProgress, MenuItem, Select, TextField, Tooltip } from '@mui/material';
import { api, errMsg } from '../services/api';
import { useNotify } from './Notifier';
import { CONNECTIONS_CHANGED } from '../hooks/useConnectionStatus';
import type { DatabaseList, DbType } from '../types';

interface Props {
  dbType: DbType;
  /** changes when another connection becomes the active one, so the list is reloaded */
  profileId?: number;
  selected?: string | null;
  onChanged?: () => void;
  minWidth?: number;
  /** style for the dark top bar */
  onBar?: boolean;
}

/**
 * Databases the active connection's own database user may access, discovered from the server after connecting.
 * Choosing one switches this connection only (no reconnect, nothing else is affected). If the server will not list
 * databases for the user, a name can be typed instead; the server still enforces permissions on every query.
 */
export default function DatabaseSelect({ dbType, profileId, selected, onChanged, minWidth = 190, onBar }: Props) {
  const [info, setInfo] = useState<DatabaseList | null>(null);
  const [busy, setBusy] = useState(false);
  const notify = useNotify();
  const label = `Active ${dbType === 'MONGODB' ? 'MongoDB' : 'MySQL'} database`;

  const load = useCallback(() => api.databases(dbType).then(setInfo).catch(() => setInfo(null)), [dbType]);
  useEffect(() => { void load(); }, [load, profileId]);

  const change = async (name: string) => {
    if (!name || name === selected) return;
    setBusy(true);
    try {
      await api.useDatabase(name, dbType);
      notify.success(`Now using database ${name}`);
      window.dispatchEvent(new Event(CONNECTIONS_CHANGED));
      onChanged?.();
    } catch (e) {
      notify.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const names = info ? (selected && !info.databases.includes(selected) ? [selected, ...info.databases] : info.databases) : selected ? [selected] : [];
  const sx = { minWidth, ...(onBar ? { bgcolor: 'background.paper', color: 'text.primary' } : {}) };
  const hint = info?.message ?? undefined;

  if (info?.restricted) {
    return (
      <Tooltip title={hint ?? ''}>
        <Box component="span" sx={{ display: 'inline-block' }}>
        <Autocomplete freeSolo size="small" options={names} value={selected ?? ''} disabled={busy} sx={sx} onChange={(_, v) => { if (typeof v === 'string') void change(v.trim()); }}
          renderInput={(p) => <TextField {...p} placeholder="Type a database name" inputProps={{ ...p.inputProps, 'aria-label': label }}
            onKeyDown={(e) => { if (e.key === 'Enter') void change((e.target as HTMLInputElement).value.trim()); }} />} />
        </Box>
      </Tooltip>
    );
  }
  return (
    <Tooltip title={hint ?? (names.length === 0 ? 'No accessible databases' : '')}>
      {/* a plain element between Tooltip and Select: Tooltip's blur handler cannot cope with InputBase calling onBlur() without an event */}
      <Box component="span" sx={{ display: 'inline-block' }}>
      <Select size="small" displayEmpty value={selected ?? ''} disabled={busy} sx={sx} onOpen={() => void load()} onChange={(e) => void change(e.target.value)}
        inputProps={{ 'aria-label': label }} endAdornment={busy ? <CircularProgress size={16} sx={{ mr: 3 }} /> : undefined}
        renderValue={(v) => (v ? String(v) : <span style={{ opacity: 0.65 }}>Select database…</span>)}>
        {names.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
        {names.length === 0 && <MenuItem disabled value="">No accessible databases</MenuItem>}
      </Select>
      </Box>
    </Tooltip>
  );
}
