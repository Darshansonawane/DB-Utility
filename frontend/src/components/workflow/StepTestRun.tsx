import { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Tooltip } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { ApiRequestDef, ApiRunResult, QueryResult, SavedQuery, Workflow, WorkflowStep } from '../../types';
import DynamicForm from '../DynamicForm';
import ResultTable from '../ResultTable';
import { initialValues, missingRequired, ms } from '../../utils/format';

/** Values a step parameter already has while editing: a constant, or the default of the workflow input it reads. */
export function knownValues(step: WorkflowStep, inputs: Workflow['inputs']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of step.mappings) {
    if (m.sourceType === 'CONSTANT' && (m.constantValue ?? '') !== '') out[m.paramName] = m.constantValue ?? '';
    if (m.sourceType === 'INPUT') {
      const d = inputs.find((i) => i.name === m.sourceRef)?.defaultValue;
      if ((d ?? '').trim()) out[m.paramName] = d ?? '';
    }
  }
  return out;
}

/**
 * "Test step" while building a workflow: runs this one step on its own so its output can be checked before saving. A DB query step runs
 * its saved (read-only) query, with test values asked only for what is not already known; an API step sends its request.
 */
export default function StepTestRun({ step, inputs, query, apiRequest }: { step: WorkflowStep; inputs: Workflow['inputs']; query?: SavedQuery; apiRequest?: ApiRequestDef }) {
  const { loading, error, setError, run } = useAsync();
  const [values, setValues] = useState<Record<string, string>>({});
  const [dbResult, setDbResult] = useState<QueryResult | null>(null);
  const [apiResult, setApiResult] = useState<ApiRunResult | null>(null);

  const known = useMemo(() => knownValues(step, inputs), [step, inputs]);
  // ask only for what has no value yet (Automatic parameters resolve from their variable)
  const asked = useMemo(() => (query?.parameters ?? []).filter((p) => !(p.name in known) && !(p.defaultValue ?? '').trim()), [query, known]);
  const write = query?.queryType === 'WRITE';

  const exec = async () => {
    setDbResult(null); setApiResult(null);
    if (apiRequest) { const r = await run(() => api.runApiRequest(apiRequest)); if (r) setApiResult(r); return; }
    if (!query?.id) return;
    const all = { ...initialValues(asked), ...values };
    const missing = missingRequired(asked, all);
    if (missing.length) return setError(`Enter a test value for: ${missing.join(', ')}`);
    const r = await run(() => api.executeQuery(query.id!, { ...known, ...all }));
    if (r) setDbResult(r);
  };

  if (!query && !apiRequest) return null;
  return (
    <Stack spacing={1}>
      {asked.length > 0 && <DynamicForm parameters={asked} values={{ ...initialValues(asked), ...values }} onChange={setValues} disabled={loading} />}
      <Stack direction="row" spacing={1} alignItems="center">
        <Tooltip title={write ? "Write queries can't be test-run here. Run the workflow to preview and confirm them." : ''}>
          <Box component="span"><Button size="small" variant="outlined" startIcon={<PlayArrowIcon />} onClick={exec} disabled={loading || write}>Test step</Button></Box>
        </Tooltip>
        {dbResult && <><Chip size="small" color="success" label={`${dbResult.rowCount} row(s)`} /><Chip size="small" label={ms(dbResult.durationMs)} /></>}
        {apiResult && <><Chip size="small" color={apiResult.success ? 'success' : 'error'} label={apiResult.status ?? 'No response'} /><Chip size="small" label={ms(apiResult.durationMs)} /></>}
      </Stack>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {dbResult && dbResult.columns.length > 0 && <ResultTable columns={dbResult.columns} rows={dbResult.rows} truncated={dbResult.truncated} maxHeight={240} />}
      {apiResult && (
        <>
          {apiResult.error && <Alert severity="error">{apiResult.error}</Alert>}
          {apiResult.body && <Box component="pre" sx={{ m: 0, p: 1.5, maxHeight: 240, overflow: 'auto', fontSize: 12.5, borderRadius: 1, bgcolor: 'action.hover', whiteSpace: 'pre-wrap' }}>{apiResult.body}</Box>}
        </>
      )}
    </Stack>
  );
}
