import { useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../../services/api';
import RunEnvironment from '../RunEnvironment';
import { useAsync } from '../../hooks/useAsync';
import type { ApiExtraction, ApiRequestDef, ApiRunResult, Folder, PreviewResult } from '../../types';
import { FolderSelect } from '../folders/FolderPicker';
import ResultPanel from './ResultPanel';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SOURCES: ApiExtraction['source'][] = ['BODY', 'BODY_REGEX', 'HEADER', 'STATUS'];
const EXAMPLE_SCRIPT = '// Runs before the request is sent. Example:\nvar name = "Darshan" + timestamp();     // Darshan + current time in ms\nvars.set("accountName", name);          // save it: use {{accountName}} anywhere, e.g. in a query\nvar b = JSON.parse(request.body);       // change the body\nb.accountName = name;\nb.requestId = uuid();\nrequest.body = b;                       // an object is converted to JSON for you\nconsole.log("sending", name);';

export const EMPTY_REQUEST: ApiRequestDef = { name: '', method: 'POST', url: '', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '', extractions: [], expectedStatus: null };


export default function RequestDialog({ initial, folders, onClose, onSaved }: { initial: ApiRequestDef; folders: Folder[]; onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<ApiRequestDef>(initial);
  const [result, setResult] = useState<ApiRunResult | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const { loading, error, run } = useAsync();
  const set = (p: Partial<ApiRequestDef>) => setR((c) => ({ ...c, ...p }));
  const dirty = JSON.stringify(r) !== JSON.stringify(initial);
  const close = () => { if (!dirty || window.confirm('You have unsaved changes to this request. Close without saving?')) onClose(); };
  const showPreview = async () => { const p = await run(() => api.previewApiRequest(r)); if (p) setPreview(p); };
  const remember = (rules: ApiExtraction[]) => setR((c) => ({ ...c, extractions: [...c.extractions.filter((e) => !rules.some((n) => n.variable === e.variable)), ...rules] }));
  const send = async () => { const x = await run(() => api.runApiRequest(r)); if (x) setResult(x); };
  const save = async () => { const x = await run(() => api.saveApiRequest(r)); if (x) onSaved(); };
  return (
    <Dialog open onClose={close} maxWidth="lg" fullWidth>
      <DialogTitle>{r.id ? 'Edit API request' : 'New API request'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {dirty && <Alert severity="warning" sx={{ py: 0 }}>Unsaved changes: Send tests what you see here, but workflows and the Run button use the saved version. Click Save to keep your edits.</Alert>}
          <Alert severity="info" sx={{ py: 0 }}>
            Use <code>{'{{variable}}'}</code> in the URL, headers and body. Built-ins: <code>{'{{$uuid}} {{$timestamp}} {{$isoDate}} {{$randomInt}}'}</code>.
            QA, Staging and Development hosts only; <i>Send</i> really calls the API.
          </Alert>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField size="small" label="Name" required fullWidth value={r.name} onChange={(e) => set({ name: e.target.value })} />
            <Box sx={{ minWidth: 220 }}><FolderSelect folders={folders} value={r.folderId} onChange={(id) => set({ folderId: id })} /></Box>
            <TextField size="small" select label="Method" value={r.method} onChange={(e) => set({ method: e.target.value })} sx={{ minWidth: 120 }}>
              {METHODS.map((m) => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </TextField>
            <TextField size="small" type="number" label="Expected status" placeholder="2xx" value={r.expectedStatus ?? ''}
              onChange={(e) => set({ expectedStatus: e.target.value ? Number(e.target.value) : null })} sx={{ minWidth: 150 }} />
          </Stack>
          <TextField size="small" label="URL" required fullWidth value={r.url} placeholder="https://qa-api.example.com/wallets" onChange={(e) => set({ url: e.target.value })} />
          <Typography variant="subtitle2">Headers</Typography>
          {r.headers.map((h, i) => (
            <Stack key={i} direction="row" spacing={1}>
              <TextField size="small" label="Name" value={h.name} onChange={(e) => set({ headers: r.headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <TextField size="small" label="Value" fullWidth value={h.value} placeholder="Bearer {{token}}" onChange={(e) => set({ headers: r.headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <IconButton aria-label="remove header" onClick={() => set({ headers: r.headers.filter((_, j) => j !== i) })}><DeleteIcon /></IconButton>
            </Stack>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => set({ headers: [...r.headers, { name: '', value: '' }] })}>Add header</Button></Box>
          {r.method !== 'GET' && (
            <TextField size="small" label="Body" fullWidth multiline minRows={4} value={r.body ?? ''} onChange={(e) => set({ body: e.target.value })}
              slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
          )}
          <Typography variant="subtitle2">Save from response into variables</Typography>
          {r.extractions.map((x, i) => (
            <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField size="small" label="Variable name" value={x.variable} onChange={(e) => set({ extractions: r.extractions.map((y, j) => (j === i ? { ...y, variable: e.target.value } : y)) })} />
              <TextField size="small" select label="From" value={x.source} sx={{ minWidth: 140 }} onChange={(e) => set({ extractions: r.extractions.map((y, j) => (j === i ? { ...y, source: e.target.value as ApiExtraction['source'] } : y)) })}>
                {SOURCES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
              <TextField size="small" fullWidth disabled={x.source === 'STATUS'} label={x.source === 'HEADER' ? 'Header name' : x.source === 'BODY_REGEX' ? 'Regex (first group)' : 'JSON path'}
                placeholder={x.source === 'BODY' ? 'data.walletId  or  items[0].id' : ''} value={x.path ?? ''} onChange={(e) => set({ extractions: r.extractions.map((y, j) => (j === i ? { ...y, path: e.target.value } : y)) })} />
              <Box sx={{ minWidth: 190 }}><FolderSelect folders={folders} label="Save in folder" noneLabel="Unfiled" value={x.folderId}
                onChange={(id) => set({ extractions: r.extractions.map((y, j) => (j === i ? { ...y, folderId: id || null } : y)) })} /></Box>
              <FormControlLabel label="Secret" control={<Checkbox checked={x.secret} onChange={(e) => set({ extractions: r.extractions.map((y, j) => (j === i ? { ...y, secret: e.target.checked } : y)) })} />} />
              <IconButton aria-label="remove extraction" onClick={() => set({ extractions: r.extractions.filter((_, j) => j !== i) })}><DeleteIcon /></IconButton>
            </Stack>
          ))}
          <Box><Button size="small" startIcon={<AddIcon />} onClick={() => set({ extractions: [...r.extractions, { variable: '', source: 'BODY', path: '', secret: false }] })}>Add variable</Button></Box>
          <Accordion disableGutters variant="outlined" defaultExpanded={!!r.preScript}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2">Pre-request script (JavaScript){r.preScript ? ' · on' : ''}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1}>
                <Typography variant="caption" color="text.secondary">
                  Runs before every send, in a sandbox (no files, network or Java access; stops after 3 s). Change the request with <code>request.url</code>, <code>request.method</code>,
                  <code> request.headers['Name']</code> and <code>request.body</code>. Use <code>vars.get('x')</code>, <code>vars.set('x', value, secret?)</code> (saved as a variable),
                  <code> console.log()</code>, and helpers <code>uuid() timestamp() isoDate(days) isoDateTime(days) randomInt(min,max) randomString(n) randomNumeric(n) pick(array)
                  base64(s) base64Decode(s) sha256(s) hmacSha256(key,s)</code>. Variables you set can be used as <code>{'{{name}}'}</code> in the URL, headers and body.
                  Without a script you can still write <code>{'{{$randomString(8)}} {{$randomInt(1,100)}} {{$isoDate(+7)}}'}</code> directly in the body.
                </Typography>
                <TextField multiline minRows={8} fullWidth value={r.preScript ?? ''} placeholder="// no script" spellCheck={false}
                  onChange={(e) => set({ preScript: e.target.value })} slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: 13 } } }} />
                <Box><Button size="small" onClick={() => set({ preScript: EXAMPLE_SCRIPT })}>Insert example</Button>
                  <Button size="small" disabled={!r.preScript} onClick={() => set({ preScript: '' })}>Clear</Button></Box>
              </Stack>
            </AccordionDetails>
          </Accordion>
          {preview && (
            <Alert severity={preview.ready ? 'success' : 'warning'} onClose={() => setPreview(null)}>
              <Typography variant="subtitle2">{preview.ready ? 'All variables resolve' : 'Some variables are not set yet'}</Typography>
              {preview.tokens.length === 0 && <Typography variant="body2">No variables used.</Typography>}
              {preview.tokens.map((t, i) => (
                <Typography key={i} variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {t.token} → {t.found ? `${t.value ?? ''}  (${t.origin})` : 'NOT SET: run the step that produces it or add it under Variables'}
                </Typography>
              ))}
              <Box component="pre" sx={{ m: 0, mt: 1, fontSize: 12, whiteSpace: 'pre-wrap' }}>{`${preview.method} ${preview.url}\n${Object.entries(preview.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}${preview.body ? `\n\n${preview.body}` : ''}`}</Box>
            </Alert>
          )}
          {result && <ResultPanel r={result} folders={folders} requestName={r.name} onRemember={remember} />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Close</Button>
        <Button variant="text" onClick={showPreview} disabled={loading || !r.url.trim()}>Preview values</Button>
        <RunEnvironment />
        <Button startIcon={<PlayArrowIcon />} variant="outlined" onClick={send} disabled={loading || !r.url.trim()}>Send</Button>
        <Button variant="contained" onClick={save} disabled={loading || !r.name.trim() || !r.url.trim()}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

