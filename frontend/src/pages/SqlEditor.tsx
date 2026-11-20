import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, MenuItem, Paper, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { ParamType, ParamValue, QueryParameter, QueryResult, SavedQuery, SqlAnalysis, WritePreview } from '../types';
import { ms } from '../utils/format';
import ResultTable from '../components/ResultTable';
import SchemaInspector from '../components/SchemaInspector';
import SqlEditorBox from '../components/SqlEditorBox';
import WritePreviewDialog from '../components/WritePreviewDialog';
import QueryEditDialog from '../components/QueryEditDialog';

const TYPES: ParamType[] = ['STRING', 'INTEGER', 'DECIMAL', 'DATE', 'DATETIME', 'BOOLEAN'];

export default function SqlEditor() {
  const [tab, setTab] = useState(0);
  const [sql, setSql] = useState('SELECT 1');
  const [analysis, setAnalysis] = useState<SqlAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [params, setParams] = useState<(QueryParameter & { value: string })[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [preview, setPreview] = useState<WritePreview | null>(null);
  const [saved, setSaved] = useState<SavedQuery[]>([]);
  const [loaded, setLoaded] = useState<SavedQuery | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const { loading, error, setError, run } = useAsync();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reloadSaved = () => void run(async () => setSaved(await api.queries()));
  useEffect(reloadSaved, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced analysis: detects statement type and "?" placeholders, validates SQL on the server.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!sql.trim()) { setAnalysis(null); setAnalysisError(null); return; }
      try {
        const a = await api.analyzeSql(sql);
        setAnalysis(a);
        setAnalysisError(null);
        setParams((cur) => a.suggestedParameters.map((s, i) => ({ ...s, value: cur[i]?.value ?? '', type: cur[i]?.type ?? s.type })));
      } catch (e) {
        setAnalysis(null);
        setAnalysisError(e instanceof Error ? e.message : 'Invalid SQL');
        const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
        if (msg) setAnalysisError(msg);
      }
    }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [sql]);

  const paramValues = (): ParamValue[] => params.map((p) => ({ type: p.type, value: p.value }));
  const write = analysis?.write ?? false;

  const execute = async () => {
    setResult(null);
    if (write) {
      const p = await run(() => api.previewSql(sql, paramValues()));
      if (p) setPreview(p);
    } else {
      const r = await run(() => api.executeSql(sql, paramValues()));
      if (r) setResult(r);
    }
  };

  const confirm = async () => {
    const token = preview?.confirmationToken ?? undefined;
    const r = await run(() => api.executeSql(sql, paramValues(), token));
    setPreview(null);
    if (r) setResult(r);
  };

  const load = (id: string) => {
    const q = saved.find((s) => String(s.id) === id) ?? null;
    setLoaded(q);
    if (q) { setSql(q.sql); setResult(null); setError(null); }
  };

  const toSave = (): SavedQuery => loaded
    ? { ...loaded, sql, parameters: params.map(({ value: _v, ...p }) => p) }
    : { name: '', description: '', category: '', sql, environments: [], enabled: true, parameters: params.map(({ value: _v, ...p }) => p) };

  return (
    <Stack spacing={2}>
      <Typography variant="h5">SQL Editor</Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab label="Editor" /><Tab label="Schema inspector" />
      </Tabs>
      {tab === 1 && <SchemaInspector />}
      {tab === 0 && (
        <>
          <Alert severity="info">
            One statement at a time. Use <b>?</b> placeholders: values are bound as typed parameters, never pasted into the SQL. Writes need
            read-only mode off, ad-hoc writes enabled (or save the statement to the library), a preview and your explicit confirmation.
          </Alert>
          <Stack direction="row" spacing={2} alignItems="center">
            <TextField select size="small" label="Load saved query" sx={{ minWidth: 340 }} value={loaded?.id ? String(loaded.id) : ''} onChange={(e) => load(e.target.value)}>
              {saved.map((q) => <MenuItem key={q.id} value={String(q.id)}>{q.category ? `[${q.category}] ` : ''}{q.name}</MenuItem>)}
            </TextField>
            {analysis && <Chip label={analysis.statementType} color={analysis.write ? 'warning' : 'primary'} size="small" />}
            {loaded && <Chip label={`Editing: ${loaded.name}`} size="small" onDelete={() => setLoaded(null)} />}
          </Stack>
          <SqlEditorBox value={sql} onChange={setSql} height={260} />
          {analysisError && <Alert severity="warning">{analysisError}</Alert>}
          {params.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Parameters (in order of the "?" placeholders)</Typography>
              <Stack spacing={1.5}>
                {params.map((p, i) => (
                  <Stack key={i} direction="row" spacing={1}>
                    <TextField size="small" label={`${i + 1}. ${p.label}`} fullWidth value={p.value}
                      type={p.type === 'DATE' ? 'date' : p.type === 'DATETIME' ? 'datetime-local' : 'text'} InputLabelProps={p.type === 'DATE' || p.type === 'DATETIME' ? { shrink: true } : undefined}
                      onChange={(e) => setParams(params.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
                    <TextField size="small" select label="Type" sx={{ minWidth: 130 }} value={p.type}
                      onChange={(e) => setParams(params.map((x, k) => (k === i ? { ...x, type: e.target.value as ParamType, value: '' } : x)))}>
                      {TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </TextField>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}
          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={execute} disabled={loading || !!analysisError || !sql.trim()} color={write ? 'warning' : 'primary'}>
              {write ? 'Preview write' : 'Execute'}
            </Button>
            <Button variant="outlined" onClick={() => setSaveOpen(true)} disabled={!sql.trim() || !!analysisError}>{loaded ? 'Update saved query' : 'Save query'}</Button>
            <Button onClick={() => { setSql(''); setResult(null); setLoaded(null); setError(null); setParams([]); }}>Clear</Button>
          </Stack>
          {error && <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>{error}</Alert>}
          {result && (
            <Box>
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Chip size="small" label={`Duration ${ms(result.durationMs)}`} />
                {result.affectedRows !== null && result.affectedRows !== undefined
                  ? <Chip size="small" color="success" label={`${result.affectedRows} row(s) affected`} />
                  : <Chip size="small" label={`${result.rowCount} row(s)`} />}
              </Stack>
              <ResultTable columns={result.columns} rows={result.rows} truncated={result.truncated} />
            </Box>
          )}
        </>
      )}
      <WritePreviewDialog preview={preview} busy={loading} onConfirm={confirm} onClose={() => setPreview(null)} />
      <QueryEditDialog open={saveOpen} initial={toSave()} onClose={() => setSaveOpen(false)} onSaved={(q) => { setSaveOpen(false); setLoaded(q); reloadSaved(); }} />
    </Stack>
  );
}
