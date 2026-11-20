import { useState } from 'react';
import { Alert, Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import type { Column } from '../types';
import { cell } from '../utils/format';

interface Props {
  columns: Column[]; rows: unknown[][]; truncated?: boolean; maxHeight?: number; emptyText?: string;
  /** When given, a cell can be edited by double-clicking it; Enter submits the new text here, Esc cancels. */
  onEditCell?: (rowIndex: number, column: string, value: string) => void;
}

export default function ResultTable({ columns, rows, truncated, maxHeight = 380, emptyText = 'No rows returned.', onEditCell }: Props) {
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const commit = () => { if (editing) { const cur = rows[editing.r]?.[editing.c]; if (editing.text !== (cur == null ? '' : String(cur))) onEditCell?.(editing.r, columns[editing.c].name, editing.text); setEditing(null); } };
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
              <TableRow key={ri} hover className={ri < 14 ? 'row-cascade' : undefined} style={ri < 14 ? ({ '--i': ri } as React.CSSProperties) : undefined}>
                {r.map((v, ci) => (
                  <TableCell key={ci} title={onEditCell ? 'Double-click to edit' : undefined} onDoubleClick={onEditCell ? () => setEditing({ r: ri, c: ci, text: v == null ? '' : String(v) }) : undefined}
                    sx={{ cursor: onEditCell ? 'cell' : undefined, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: v === null ? 'text.disabled' : 'text.primary', fontStyle: v === null ? 'italic' : 'normal' }}>
                    {editing && editing.r === ri && editing.c === ci ? (
                      <TextField size="small" autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onBlur={() => setEditing(null)}
                        inputProps={{ 'aria-label': `edit ${columns[ci].name}`, style: { fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px' } }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') setEditing(null); }} />
                    ) : cell(v)}
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
