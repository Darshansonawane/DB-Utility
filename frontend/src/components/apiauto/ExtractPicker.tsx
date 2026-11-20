import { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { errMsg } from '../../services/api';
import type { Folder } from '../../types';
import { folderPaths } from '../folders/folderUtils';

export interface PickEntry { key: string; value: string }
export interface PickItem { key: string; name: string; value: string; secret: boolean; folderId: number }

const VALID = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;

/**
 * Pick which values from an API response or a SQL result to keep as variables: tick the fields, name them, choose the Variables
 * folder and (optionally) remember the choice as an extraction rule so it repeats on every run.
 */
export default function ExtractPicker({ title, keyLabel, entries, folders, defaultName, onSave, canRemember }: {
  title: string; keyLabel: string; entries: PickEntry[]; folders: Folder[]; defaultName: (key: string) => string;
  onSave: (items: PickItem[], remember: boolean) => Promise<void>; canRemember: boolean;
}) {
  const paths = useMemo(() => folderPaths(folders), [folders]);
  const [sel, setSel] = useState<Record<string, { name: string; secret: boolean; folderId: number } | undefined>>({});
  const [remember, setRemember] = useState(canRemember);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = entries.filter((e) => sel[e.key]);
  const invalid = chosen.filter((e) => !VALID.test(sel[e.key]!.name));
  const upd = (key: string, patch: Partial<{ name: string; secret: boolean; folderId: number }>) =>
    setSel((s) => ({ ...s, [key]: { ...s[key]!, ...patch } }));

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await onSave(chosen.map((e) => ({ key: e.key, name: sel[e.key]!.name.trim(), value: e.value, secret: sel[e.key]!.secret, folderId: sel[e.key]!.folderId })), remember && canRemember);
      setMsg({ ok: true, text: `Saved ${chosen.length} variable(s). Use them as ${chosen.slice(0, 3).map((e) => `{{${sel[e.key]!.name}}}`).join(', ')}${chosen.length > 3 ? '…' : ''}.` });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  };

  if (entries.length === 0) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="caption" color="text.secondary">Tick the values you want to reuse, name them and pick the Variables folder.</Typography>
      <Box sx={{ maxHeight: 280, overflow: 'auto', mt: 0.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader>
          <TableHead><TableRow><TableCell padding="checkbox" /><TableCell>{keyLabel}</TableCell><TableCell>Value</TableCell><TableCell>Variable name</TableCell><TableCell>Folder</TableCell><TableCell>Secret</TableCell></TableRow></TableHead>
          <TableBody>
            {entries.map((e) => {
              const s = sel[e.key];
              return (
                <TableRow key={e.key} hover selected={!!s}>
                  <TableCell padding="checkbox"><Checkbox size="small" checked={!!s} inputProps={{ 'aria-label': `select ${e.key}` }}
                    onChange={(ev) => setSel((cur) => ({ ...cur, [e.key]: ev.target.checked ? { name: defaultName(e.key), secret: false, folderId: 0 } : undefined }))} /></TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{e.key}</TableCell>
                  <TableCell sx={{ maxWidth: 220, wordBreak: 'break-all', fontSize: 12 }}>{e.value.length > 80 ? `${e.value.slice(0, 80)}…` : e.value}</TableCell>
                  <TableCell>{s && <TextField size="small" value={s.name} error={!VALID.test(s.name)} onChange={(ev) => upd(e.key, { name: ev.target.value })} inputProps={{ 'aria-label': `variable name for ${e.key}` }} />}</TableCell>
                  <TableCell>{s && (
                    <TextField size="small" select value={s.folderId} onChange={(ev) => upd(e.key, { folderId: Number(ev.target.value) })} sx={{ minWidth: 150 }} inputProps={{ 'aria-label': `folder for ${e.key}` }}>
                      <MenuItem value={0}>Unfiled</MenuItem>
                      {[...paths.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, p]) => <MenuItem key={id} value={id}>{p}</MenuItem>)}
                    </TextField>)}</TableCell>
                  <TableCell>{s && <Checkbox size="small" checked={s.secret} onChange={(ev) => upd(e.key, { secret: ev.target.checked })} inputProps={{ 'aria-label': `secret ${e.key}` }} />}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1 }}>
        <Button variant="contained" size="small" disabled={busy || chosen.length === 0 || invalid.length > 0} onClick={save}>Save {chosen.length || ''} as variables</Button>
        {canRemember && <FormControlLabel label="Remember as extraction rules (repeat on every run)" control={<Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} />} />}
      </Stack>
      {invalid.length > 0 && <Alert severity="warning" sx={{ mt: 1, py: 0 }}>Variable names use letters, digits, _ . - and must start with a letter or _.</Alert>}
      {msg && <Alert severity={msg.ok ? 'success' : 'error'} sx={{ mt: 1, py: 0 }}>{msg.text}</Alert>}
    </Box>
  );
}
