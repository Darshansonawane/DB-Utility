import { Alert, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import type { Column } from '../types';
import { cell } from '../utils/format';

interface Props { columns: Column[]; rows: unknown[][]; truncated?: boolean; maxHeight?: number; emptyText?: string }

export default function ResultTable({ columns, rows, truncated, maxHeight = 380, emptyText = 'No rows returned.' }: Props) {
  if (columns.length === 0) return <Typography color="text.secondary" variant="body2">{emptyText}</Typography>;
  return (
    <Box>
      {truncated && <Alert severity="warning" sx={{ mb: 1 }}>Result limited to the configured maximum number of rows. Refine the query or raise the limit in Settings.</Alert>}
      <TableContainer sx={{ maxHeight, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader aria-label="results">
          <TableHead>
            <TableRow>
              {columns.map((c, i) => (
                <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: 'nowrap', bgcolor: (t) => (t.palette.mode === 'dark' ? t.palette.grey[900] : t.palette.grey[100]) }}>{c.name}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={columns.length}><Typography variant="body2" color="text.secondary">{emptyText}</Typography></TableCell></TableRow>
            )}
            {rows.map((r, ri) => (
              <TableRow key={ri} hover>
                {r.map((v, ci) => (
                  <TableCell key={ci} sx={{ whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: v === null ? 'text.disabled' : 'text.primary', fontStyle: v === null ? 'italic' : 'normal' }}>
                    {cell(v)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
