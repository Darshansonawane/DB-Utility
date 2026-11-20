import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, FormControlLabel, Stack, Switch, TextField, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { AppSettings } from '../types';

export default function Settings() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const { loading, error, run } = useAsync();
  useEffect(() => { void run(async () => setS(await api.settings())); }, [run]);
  if (!s) return error ? <Alert severity="error">{error}</Alert> : null;
  const num = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setS({ ...s, [k]: Number(e.target.value) }); };
  const flag = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) => { setSaved(false); setS({ ...s, [k]: e.target.checked }); };
  return (
    <Stack spacing={2} sx={{ maxWidth: 720 }}>
      <Typography variant="h5">Settings</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">Settings saved and recorded in the audit log.</Alert>}
      <Card><CardContent>
        <Stack spacing={2}>
          <FormControlLabel control={<Switch checked={s.readOnlyMode} onChange={flag('readOnlyMode')} />} label="Read-only mode (blocks INSERT / UPDATE / DELETE from Saved Queries and the SQL editor)" />
          {!s.readOnlyMode && <Alert severity="warning">Writes from Saved Queries and the SQL editor are enabled: each still needs a preview and an explicit confirmation, stays within the affected-row limit and is audited. Workflow steps run INSERT / UPDATE / DELETE automatically (whatever this switch says) using the database user's own privileges.</Alert>}
          <FormControlLabel control={<Switch checked={s.adHocWritesEnabled} onChange={flag('adHocWritesEnabled')} />} label="Allow ad-hoc writes from the SQL Editor (otherwise writes must be saved queries)" />
          <FormControlLabel control={<Switch checked={s.maskSensitiveData} onChange={flag('maskSensitiveData')} />} label="Mask identifiers in history and audit logs" />
          <TextField size="small" type="number" label="Maximum result rows" value={s.maxResultRows} onChange={num('maxResultRows')} />
          <TextField size="small" type="number" label="Query timeout (seconds)" value={s.queryTimeoutSeconds} onChange={num('queryTimeoutSeconds')} />
          <TextField size="small" type="number" label="Maximum affected rows per write" value={s.maxAffectedRows} onChange={num('maxAffectedRows')} />
          <Button variant="contained" disabled={loading} sx={{ alignSelf: 'flex-start' }} onClick={async () => { const r = await run(() => api.saveSettings(s)); if (r) { setS(r); setSaved(true); } }}>Save settings</Button>
        </Stack>
      </CardContent></Card>
    </Stack>
  );
}
