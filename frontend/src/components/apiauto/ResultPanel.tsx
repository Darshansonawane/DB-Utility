import { Alert, Box, Card, Chip, Stack, Typography } from '@mui/material';
import type { ApiRunResult, Folder, ApiExtraction } from '../../types';
import ResponseExtractor from './ResponseExtractor';

export function pretty(body?: string) {
  if (!body) return '';
  try { return JSON.stringify(JSON.parse(body), null, 2); } catch { return body; }
}

export default function ResultPanel({ r, folders, requestName, onRemember }: { r: ApiRunResult; folders?: Folder[]; requestName?: string; onRemember?: (rules: ApiExtraction[]) => void }) {
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" color={r.success ? 'success' : 'error'} label={r.success ? 'SUCCESS' : 'FAILED'} />
        {r.status != null && <Chip size="small" label={`HTTP ${r.status}`} />}
        <Chip size="small" variant="outlined" label={`${r.durationMs} ms`} />
        <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{r.resolvedUrl}</Typography>
      </Stack>
      {r.error && <Alert severity="error" sx={{ mt: 1 }}>{r.error}</Alert>}
      {r.scriptLog && r.scriptLog.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Script console</Typography>
          <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, fontSize: 12 }}>{r.scriptLog.join('\n')}</Box>
        </Box>
      )}
      {r.sent && (
        <Box component="details" sx={{ mt: 1 }}>
          <summary>Request sent (after script and variables; secrets masked)</summary>
          <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, maxHeight: 240, overflow: 'auto', fontSize: 12 }}>
            {`${r.sent.method} ${r.sent.url}\n${Object.entries(r.sent.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}${r.sent.body ? `\n\n${r.sent.body}` : ''}`}
          </Box>
        </Box>
      )}
      {r.extracted.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Saved to variables</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {r.extracted.map((x) => (
              <Chip key={x.variable} size="small" color={x.found ? 'primary' : 'error'} variant="outlined"
                label={x.found ? `{{${x.variable}}} = ${x.value}` : `{{${x.variable}}} not found`} />
            ))}
          </Stack>
        </Box>
      )}
      {r.body != null && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2">Response body{r.bodyTruncated ? ' (truncated at 1 MB)' : ''}</Typography>
          <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1, maxHeight: 280, overflow: 'auto', fontSize: 12 }}>{pretty(r.body)}</Box>
        </Box>
      )}
      {Object.keys(r.headers).length > 0 && (
        <Box component="details" sx={{ mt: 1 }}>
          <summary>Response headers</summary>
          <Box component="pre" sx={{ m: 0, fontSize: 12 }}>{Object.entries(r.headers).map(([k, v]) => `${k}: ${v.join(', ')}`).join('\n')}</Box>
        </Box>
      )}
      {r.body != null && folders && (
        <ResponseExtractor body={r.body} folders={folders} requestName={requestName} onRemember={onRemember} />
      )}
    </Card>
  );
}

