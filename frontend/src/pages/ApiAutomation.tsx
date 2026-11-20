import { useCallback, useEffect, useState } from 'react';
import { Alert, Stack, Tab, Tabs, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { ApiRequestDef, ApiWorkflowDef, VariableView } from '../types';
import { useFolders } from '../components/folders/FolderTree';
import RequestsTab from '../components/apiauto/RequestsTab';
import VariablesTab from '../components/apiauto/VariablesTab';
import ApiWorkflowsTab from '../components/apiwf/ApiWorkflowsTab';
import ApiRunsTab from '../components/apiwf/ApiRunsTab';
import ApiReportsTab from '../components/apiwf/ApiReportsTab';

export default function ApiAutomation() {
  const [tab, setTab] = useState(0);
  const [requests, setRequests] = useState<ApiRequestDef[]>([]);
  const [vars, setVars] = useState<VariableView[]>([]);
  const [workflows, setWorkflows] = useState<ApiWorkflowDef[]>([]);
  const [openRuns, setOpenRuns] = useState<string[]>([]);
  const { error, run } = useAsync();
  const reqFolders = useFolders('REQUEST');
  const wfFolders = useFolders('API_WORKFLOW');
  const varFolders = useFolders('VARIABLE');
  const loadReq = useCallback(async () => { const r = await run(() => api.apiRequests()); if (r) setRequests(r); }, [run]);
  const loadVars = useCallback(async () => { const v = await run(() => api.variables()); if (v) setVars(v); }, [run]);
  const loadWf = useCallback(async () => { const w = await run(() => api.apiWorkflows()); if (w) setWorkflows(w); }, [run]);
  useEffect(() => { void loadReq(); void loadVars(); void loadWf(); }, [loadReq, loadVars, loadWf]);
  const consumed = useCallback(() => setOpenRuns([]), []);

  return (
    <Stack spacing={2}>
      <Typography variant="h5" fontWeight={700}>API Automation</Typography>
      <Typography variant="body2" color="text.secondary">
        Call your QA/Staging APIs, save values from the responses (such as a new wallet id) into variables, feed them into SQL queries, and use them in workflows as {'{{name}}'}.
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
        <Tab label={`Requests Storage (${requests.length})`} /><Tab label={`API Workflows (${workflows.length})`} /><Tab label="Runs" /><Tab label="Reports" /><Tab label={`Variables (${vars.length})`} />
      </Tabs>
      {tab === 0 && <RequestsTab requests={requests} folders={reqFolders.folders} reloadFolders={reqFolders.reload} reload={() => { void loadReq(); void loadVars(); void loadWf(); }} />}
      {tab === 1 && <ApiWorkflowsTab requests={requests} workflows={workflows} folders={wfFolders.folders} reloadFolders={wfFolders.reload} reload={() => { void loadWf(); }}
        onStarted={(ids) => { setOpenRuns(ids); setTab(2); void loadVars(); }} />}
      {tab === 2 && <ApiRunsTab workflows={workflows} openRunIds={openRuns} onConsumed={consumed} />}
      {tab === 3 && <ApiReportsTab workflows={workflows} />}
      {tab === 4 && <VariablesTab vars={vars} folders={varFolders.folders} reloadFolders={varFolders.reload} reload={() => { void loadVars(); }} />}
    </Stack>
  );
}
