import { useEffect, useState } from 'react';
import { Alert, Box, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import ResultTable from './ResultTable';

type Row = Record<string, unknown>;
const asTable = (rows: Row[]) => ({ columns: Object.keys(rows[0] ?? {}).map((name) => ({ name, type: '' })), rows: rows.map((r) => Object.values(r)) });

/** Read-only inspection of real table structure, keys, sample rows and distinct values (e.g. status values). */
export default function SchemaInspector({ defaultSchemas = [] }: { defaultSchemas?: string[] }) {
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState('');
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState('');
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.table>> | null>(null);
  const [sample, setSample] = useState<Row[]>([]);
  const [column, setColumn] = useState('');
  const [values, setValues] = useState<Row[]>([]);
  const { error, run } = useAsync();

  useEffect(() => {
    void run(async () => {
      const s = await api.schemas();
      setSchemas(s);
      const pre = defaultSchemas.find((d) => s.some((x) => x.toLowerCase() === d.toLowerCase()));
      if (pre) setSchema(s.find((x) => x.toLowerCase() === pre.toLowerCase())!);
    });
  }, [run, defaultSchemas]);

  useEffect(() => {
    if (!schema) return;
    setTable(''); setDetail(null); setSample([]); setValues([]);
    void run(async () => setTables((await api.tables(schema)).map((t) => String(t.table_name))));
  }, [schema, run]);

  useEffect(() => {
    if (!schema || !table) return;
    setColumn(''); setValues([]);
    void run(async () => {
      setDetail(await api.table(schema, table));
      setSample(await api.sample(schema, table));
    });
  }, [schema, table, run]);

  useEffect(() => {
    if (!column) return;
    void run(async () => setValues(await api.distinctValues(schema, table, column)));
  }, [column, schema, table, run]);

  return (
    <Stack spacing={2}>
      <Alert severity="info">Inspect real column types, keys, current values and possible status values before any update is designed. Read-only.</Alert>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={2}>
        <TextField select size="small" label="Schema" value={schema} onChange={(e) => setSchema(e.target.value)} sx={{ minWidth: 220 }}>
          {schemas.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Table" value={table} onChange={(e) => setTable(e.target.value)} disabled={!schema} sx={{ minWidth: 280 }}>
          {tables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>
      </Stack>
      {detail && (
        <>
          <Box>
            <Typography variant="subtitle2">Primary key</Typography>
            {detail.primaryKey.length ? detail.primaryKey.map((c) => <Chip key={c} size="small" label={c} sx={{ mr: 0.5 }} />) : <Typography variant="body2">none</Typography>}
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Columns</Typography>
            <ResultTable {...asTable(detail.columns)} maxHeight={300} />
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Foreign keys</Typography>
            {detail.foreignKeys.length ? <ResultTable {...asTable(detail.foreignKeys)} maxHeight={200} /> : <Typography variant="body2">none declared</Typography>}
          </Box>
          <Box>
            <Typography variant="subtitle2" gutterBottom>Current values (10 sample rows)</Typography>
            {sample.length ? <ResultTable {...asTable(sample)} maxHeight={260} /> : <Typography variant="body2">table is empty</Typography>}
          </Box>
          <Box>
            <TextField select size="small" label="Show distinct values of column" value={column} onChange={(e) => setColumn(e.target.value)} sx={{ minWidth: 300, mb: 1 }}>
              {detail.columns.map((c) => <MenuItem key={c.column_name} value={c.column_name}>{c.column_name} ({c.column_type})</MenuItem>)}
            </TextField>
            {values.length > 0 && <ResultTable {...asTable(values)} maxHeight={240} />}
          </Box>
        </>
      )}
    </Stack>
  );
}
