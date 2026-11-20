import { useState } from 'react';
import { Alert, Box, CircularProgress, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import type { Column } from '../types';
import { cell } from '../utils/format';

interface Props {
  columns: Column[]; rows: unknown[][]; truncated?: boolean; maxHeight?: number; emptyText?: string;
  /** When given, a cell can be edited by double-clicking it; Save (or Enter) submits the new text here, Esc cancels. The editor stays open until it resolves. */
  onEditCell?: (rowIndex: number, column: string, value: string) => void | Promise<void>;
}

export default function ResultTable({ columns, rows, truncated, maxHeight = 380, emptyText = 'No rows returned.', onEditCell }: Props) {
  const [editing, setEditing] = useState<{ r: number; c: number; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    if (!editing || saving) return;
    const cur = rows[editing.r]?.[editing.c];
    if (editing.text === (cur == null ? '' : String(cur))) { setEditing(null); return; }
    setSaving(true);
    try { await onEditCell?.(editing.r, columns[editing.c].name, editing.text); setEditing(null); } catch { /* the caller reports it; keep the editor open */ } finally { setSaving(false); }
  };
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
                      <Stack direction="row" spacing={0.25} alignItems="center">
                        <TextField size="small" autoFocus value={editing.text} disabled={saving} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          inputProps={{ 'aria-label': `edit ${columns[ci].name}`, style: { fontFamily: 'inherit', fontSize: 12.5, padding: '4px 8px' } }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } else if (e.key === 'Escape') setEditing(null); }} />
                        {saving ? <CircularProgress size={18} sx={{ mx: 0.5 }} /> : (
                          <>
                            <Tooltip title="Save"><IconButton size="small" color="success" aria-label="save cell" onClick={() => void commit()}><CheckIcon fontSize="small" /></IconButton></Tooltip>
                            <Tooltip title="Cancel"><IconButton size="small" aria-label="cancel edit" onClick={() => setEditing(null)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                          </>
                        )}
                      </Stack>
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
