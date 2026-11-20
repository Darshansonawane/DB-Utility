import { useEffect, useState } from 'react';
import { Alert, Box, Card, CardContent, Chip, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { api } from '../services/api';
import { useAsync } from '../hooks/useAsync';
import type { Dashboard as D } from '../types';
import StatusChip from '../components/StatusChip';
import { StatSkeleton, TableSkeleton } from '../components/Skeletons';
import { envLabel } from '../utils/environments';
import { APP_TAGLINE } from '../brand';

function Stat({ label, value, color, i = 0 }: { label: string; value: React.ReactNode; color?: string; i?: number }) {
  return (
    <Card className="fade-up hover-lift" style={{ '--i': i } as React.CSSProperties} sx={{ flex: 1, minWidth: 190 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">{label}</Typography>
        <Typography variant="h4" sx={{ color }}>{value}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const [d, setD] = useState<D | null>(null);
  const [loaded, setLoaded] = useState(false);
  const { error, run } = useAsync();
  useEffect(() => { void run(async () => setD(await api.dashboard())).finally(() => setLoaded(true)); }, [run]);
  const c = d?.connection;
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5">Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">{APP_TAGLINE}</Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {!loaded ? (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap><StatSkeleton /><StatSkeleton /><StatSkeleton /></Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></Stack>
        </>
      ) : (
        <>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Stat i={0} label="Active connection" value={<Typography variant="h6">{c?.connected ? c.connectionName : 'None'}</Typography>} />
            <Stat i={1} label="Environment" value={<Typography variant="h6">{c?.environment ? envLabel(c.environment) : '-'}</Typography>} />
            <Stat i={2} label="Connection status" value={<Chip color={c?.connected ? 'success' : 'default'} label={c?.connected ? `Connected (${c.latencyMs} ms)` : (c?.message ?? 'Unknown')} />} />
          </Stack>
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Stat i={3} label="Queries" value={d?.savedQueries ?? '-'} />
            <Stat i={4} label="Saved workflows" value={d?.workflows ?? '-'} />
            <Stat i={5} label="Successful executions" value={d?.successfulExecutions ?? '-'} color="success.main" />
            <Stat i={6} label="Failed executions" value={d?.failedExecutions ?? '-'} color="error.main" />
          </Stack>
        </>
      )}
      <Box>
        <Typography variant="h6" gutterBottom>Recent executions</Typography>
        <Card className="fade-up" style={{ '--i': 7 } as React.CSSProperties}>
          {!loaded ? <TableSkeleton rows={4} columns={6} /> : <Table size="small">
            <TableHead><TableRow><TableCell>When</TableCell><TableCell>Kind</TableCell><TableCell>Query</TableCell><TableCell>Env</TableCell><TableCell>Status</TableCell><TableCell>ms</TableCell></TableRow></TableHead>
            <TableBody>
              {(d?.recentExecutions ?? []).map((e, i) => (
                <TableRow key={i}>
                  <TableCell>{String(e.EXECUTED_AT ?? e.executed_at ?? '').replace('T', ' ').slice(0, 19)}</TableCell>
                  <TableCell>{String(e.KIND ?? e.kind)}</TableCell>
                  <TableCell>{String(e.QUERY_NAME ?? e.query_name ?? '(ad-hoc SQL)')}</TableCell>
                  <TableCell>{envLabel(String(e.ENVIRONMENT ?? e.environment ?? ''))}</TableCell>
                  <TableCell><StatusChip status={String(e.STATUS ?? e.status)} /></TableCell>
                  <TableCell>{String(e.DURATION_MS ?? e.duration_ms ?? '')}</TableCell>
                </TableRow>
              ))}
              {(d?.recentExecutions ?? []).length === 0 && <TableRow><TableCell colSpan={6}><Typography color="text.secondary">No executions yet.</Typography></TableCell></TableRow>}
            </TableBody>
          </Table>}
        </Card>
      </Box>
    </Stack>
  );
}
