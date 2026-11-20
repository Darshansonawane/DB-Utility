import { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { Dashboard as D } from '../types';
import StatusChip from '../components/StatusChip';

function Stat({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <Card sx={{ flex: 1, minWidth: 190 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ color }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<D | null>(null);
  const { error, run } = useAsync();
  useEffect(() => { void run(async () => setD(await api.dashboard())); }, [run]);
  const c = d?.connection;
  return (
    <Stack spacing={3}>
      <Typography variant="h5">Dashboard</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Stat label="Active connection" value={<Typography variant="h6">{c?.connected ? c.connectionName : 'None'}</Typography>} />
        <Stat label="Environment" value={<Typography variant="h6">{c?.environment ?? '-'}</Typography>} />
        <Stat label="Connection status" value={<Chip color={c?.connected ? 'success' : 'default'} label={c?.connected ? `Connected (${c.latencyMs} ms)` : (c?.message ?? 'Unknown')} />} />
      </Stack>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
        <Stat label="Saved queries" value={d?.savedQueries ?? '-'} />
        <Stat label="Saved workflows" value={d?.workflows ?? '-'} />
        <Stat label="Successful executions" value={d?.successfulExecutions ?? '-'} color="success.main" />
        <Stat label="Failed executions" value={d?.failedExecutions ?? '-'} color="error.main" />
      </Stack>
      <Box>
        <Typography variant="h6" gutterBottom>Recent executions</Typography>
        <Card>
          <Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Kind</TableCell><TableCell>Query</TableCell><TableCell>Env</TableCell><TableCell>Status</TableCell><TableCell>ms</TableCell></TableRow></TableHead>
            <TableBody>
              {(d?.recentExecutions ?? []).map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{String(e.EXECUTED_AT ?? e.executed_at ?? '').replace('T', ' ').slice(0, 19)}</TableCell>
                  <TableCell>{String(e.KIND ?? e.kind)}</TableCell>
                  <TableCell>{String(e.QUERY_NAME ?? e.query_name ?? '(ad-hoc SQL)')}</TableCell>
                  <TableCell>{String(e.ENVIRONMENT ?? e.environment ?? '')}</TableCell>
                  <TableCell><StatusChip status={String(e.STATUS ?? e.status)} /></TableCell>
                  <TableCell>{String(e.DURATION_MS ?? e.duration_ms ?? '')}</TableCell>
                </TableRow>
              ))}
              {(d?.recentExecutions ?? []).length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary">No executions yet.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>
        </Card>
      </Box>
    </Stack>
  );
}
