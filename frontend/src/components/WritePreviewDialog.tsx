import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { WritePreview } from '../types';
import ResultTable from './ResultTable';

interface Props { preview: WritePreview | null; busy?: boolean; onConfirm: () => void; onClose: () => void }

/** Step 1-3 of every write: show target records, proposed changes, limits, then require an explicit click. */
export default function WritePreviewDialog({ preview, busy, onConfirm, onClose }: Props) {
  if (!preview) return null;
  const rows = preview.affectedRows;
  return (
    <Dialog open maxWidth="lg" fullWidth onClose={busy ? undefined : onClose}>
      <DialogTitle>Review {preview.statementType} before executing</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: (t) => (t.palette.mode === 'dark' ? t.palette.grey[900] : t.palette.grey[100]), borderRadius: 1, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{preview.sql}</Box>
          {preview.params.length > 0 && (
            <Typography variant="body2" component="div">Parameters: {preview.params.map((p, i) => <Chip key={i} size="small" label={p} sx={{ mr: 0.5 }} />)}</Typography>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle2">Rows to be affected:</Typography>
            <Chip color={preview.withinLimit ? 'primary' : 'error'} label={rows === null || rows === undefined ? 'known after execution' : rows} data-testid="affected-count" />
            <Typography variant="caption" color="text.secondary">limit {preview.maxAffectedRows}</Typography>
          </Stack>
          {preview.blockedReason && <Alert severity="error">{preview.blockedReason}</Alert>}
          {preview.warnings.map((w, i) => <Alert key={i} severity="info">{w}</Alert>)}
          {preview.proposedChanges.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Proposed changes</Typography>
              <Table size="small">
                <TableHead><TableRow><TableCell>Column</TableCell><TableCell>New value / expression</TableCell></TableRow></TableHead>
                <TableBody>
                  {preview.proposedChanges.map((c, i) => (
                    <TableRow key={i}><TableCell sx={{ fontFamily: 'monospace' }}>{c.column}</TableCell><TableCell sx={{ fontFamily: 'monospace' }}>{c.newValue ?? c.expression}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
          {preview.columns.length > 0 && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Target records (current values)</Typography>
              <ResultTable columns={preview.columns} rows={preview.targetRows} maxHeight={260} />
            </Box>
          )}
          <Alert severity="warning">Writes run in a transaction that is rolled back if the affected-row limit is exceeded, but a committed change cannot be undone by this tool. Every execution is recorded in the audit log.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color="warning" disabled={!preview.executable || busy} onClick={onConfirm}>
          {busy ? 'Executing...' : 'Confirm and execute'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
