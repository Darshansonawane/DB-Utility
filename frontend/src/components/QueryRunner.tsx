import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { ParamPreview, QueryResult, SavedQuery, StatusView, WritePreview } from '../types';
import DatabaseSelect from './DatabaseSelect';
import { initialValues, missingRequired, ms } from '../utils/format';
import DynamicForm from './DynamicForm';
import ResultTable from './ResultTable';
import WritePreviewDialog from './WritePreviewDialog';
import ExtractPicker from './apiauto/ExtractPicker';
import { useFolders } from './folders/FolderTree';

/** Runs any query from the Queries Manager: generated form -> (preview + confirmation for writes) -> result. */
export default function QueryRunner({ query }: { query: SavedQuery }) {
  const [values, setValues] = useState<Record<string, string>>(initialValues(query.parameters));
  const [result, setResult] = useState<QueryResult | null>(null);
  const [preview, setPreview] = useState<WritePreview | null>(null);
  const { loading, error, setError, run } = useAsync();
  const write = query.queryType === 'WRITE';
  const varFolders = useFolders('VARIABLE');
  const [resolved, setResolved] = useState<ParamPreview[]>([]);
  const valuesKey = JSON.stringify(values);

  // the active connection of this query's database type, and the databases it can use
  const engine = query.engine ?? 'MYSQL';
  const [active, setActive] = useState<StatusView | null | undefined>(undefined);
  const loadActive = useCallback(() => api.statuses().then((l) => setActive(l.find((s) => s.dbType === engine && s.active && s.connected) ?? null)).catch(() => setActive(null)), [engine]);
  useEffect(() => { void loadActive(); }, [loadActive]);

  // show what each parameter will be bound to (variables filled in, secrets masked) before anything runs
  useEffect(() => {
    if (!query.id || query.parameters.length === 0) { setResolved([]); return; }
    const t = setTimeout(() => { api.resolveQuery(query.id!, values).then(setResolved).catch(() => setResolved([])); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.id, valuesKey]);
  const blocked = resolved.filter((p) => p.status === 'MISSING_VARIABLE' || p.status === 'INVALID');
  const firstRow = useMemo(() => {
    if (!result || result.rowCount === 0 || result.columns.length === 0) return [];
    return result.columns.map((c, i) => ({ key: c.name, value: result.rows[0][i] == null ? '' : String(result.rows[0][i]) })).filter((e) => e.value !== '');
  }, [result]);

  const submit = async () => {
    const missing = missingRequired(query.parameters, values);
    if (missing.length) return setError(`Required: ${missing.join(', ')}`);
    setResult(null);
    if (write) {
      const p = await run(() => api.previewQuery(query.id!, values));
      if (p) setPreview(p);
    } else {
      const r = await run(() => api.executeQuery(query.id!, values));
      if (r) setResult(r);
    }
  };

  const confirm = async () => {
    const token = preview?.confirmationToken ?? undefined;
    const r = await run(() => api.executeQuery(query.id!, values, token));
    setPreview(null);
    if (r) setResult(r);
  };

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">{query.description}</Typography>
      <Box component="pre" sx={{ m: 0, p: 1.5, bgcolor: (t) => (t.palette.mode === 'dark' ? t.palette.grey[900] : t.palette.grey[100]), borderRadius: 1, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{query.sql}</Box>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{engine === 'MONGODB' ? 'MongoDB' : 'MySQL'} database</Typography>
        {active
          ? <DatabaseSelect dbType={engine} profileId={active.profileId} selected={query.databaseName ?? active.databaseName} onChanged={() => void loadActive()} />
          : active === null && <Chip size="small" color="warning" label={`No active ${engine === 'MONGODB' ? 'MongoDB' : 'MySQL'} connection: connect one first`} />}
        {query.databaseName && <Typography variant="caption" color="text.secondary">This query always runs in <b>{query.databaseName}</b>.</Typography>}
      </Stack>
      <DynamicForm parameters={query.parameters} values={values} onChange={setValues} disabled={loading} />
      {resolved.some((p) => p.expression.includes('{{') || p.status !== 'OK') && (
        <Box sx={{ border: 1, borderColor: blocked.length ? 'error.main' : 'divider', borderRadius: 1, p: 1.5 }}>
          <Typography variant="subtitle2" gutterBottom>Parameter values (resolved before running)</Typography>
          <Stack spacing={0.5}>
            {resolved.map((p) => (
              <Stack key={p.name} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="body2" sx={{ minWidth: 170, fontWeight: 600 }}>{p.label}</Typography>
                {p.expression.includes('{{') && <Typography variant="caption" sx={{ fontFamily: 'monospace' }} color="text.secondary">{p.expression}</Typography>}
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>→ {p.resolved === '' ? '(empty)' : p.resolved}</Typography>
                <Chip size="small" color={p.status === 'OK' ? 'success' : p.status === 'EMPTY' ? 'default' : 'error'} label={p.status === 'OK' ? 'ready' : p.status.replace('_', ' ').toLowerCase()} />
                {p.message && <Typography variant="caption" color="error">{p.message}</Typography>}
              </Stack>
            ))}
          </Stack>
        </Box>
      )}
      <Box>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={submit} disabled={loading || !query.enabled} color={write ? 'warning' : 'primary'}>
          {write ? 'Preview changes' : 'Run query'}
        </Button>
        {!query.enabled && <Chip size="small" label="Disabled" sx={{ ml: 1 }} />}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {result && (
        <Box>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Chip size="small" label={`${ms(result.durationMs)}`} />
            {result.affectedRows !== null && result.affectedRows !== undefined
              ? <Chip size="small" color="success" label={`${result.affectedRows} row(s) affected`} />
              : <Chip size="small" label={`${result.rowCount} row(s)`} />}
          </Stack>
          {result.extracted && result.extracted.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
              <Typography variant="body2">Saved to variables:</Typography>
              {result.extracted.map((x) => <Chip key={x.variable} size="small" variant="outlined" color={x.found ? 'primary' : 'error'} label={x.found ? `{{${x.variable}}} = ${x.value}` : `{{${x.variable}}} not found`} />)}
            </Stack>
          )}
          {result.columns.length > 0 && <ResultTable columns={result.columns} rows={result.rows} truncated={result.truncated} />}
        </Box>
      )}
      {result && !write && firstRow.length > 0 && query.id && (
        <ExtractPicker title="Extract values from the first result row" keyLabel="Column" entries={firstRow} folders={varFolders.folders} canRemember
          defaultName={(k) => k.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=[0-9])/, 'v_')}
          onSave={async (items, remember) => {
            await api.saveVariablesBulk(`sql:${query.name}`, items.map((i) => ({ name: i.name, value: i.value, secret: i.secret, folderId: i.folderId || null })));
            if (remember) {
              const rules = items.map((i) => ({ variable: i.name, column: i.key, secret: i.secret, folderId: i.folderId || null }));
              const merged = [...(query.extractions ?? []).filter((e) => !rules.some((n) => n.variable === e.variable)), ...rules];
              await api.updateQuery(query.id!, { ...query, extractions: merged });
            }
          }} />
      )}
      <WritePreviewDialog preview={preview} busy={loading} onConfirm={confirm} onClose={() => setPreview(null)} />
    </Stack>
  );
}
