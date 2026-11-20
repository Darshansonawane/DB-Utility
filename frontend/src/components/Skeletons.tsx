import { Card, CardContent, Skeleton, Stack, Table, TableBody, TableCell, TableRow } from '@mui/material';

/** Placeholder rows shown while a table loads for the first time. */
export function TableSkeleton({ rows = 5, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <Table size="small" aria-busy="true" aria-label="Loading">
      <TableBody>
        {Array.from({ length: rows }).map((_, r) => (
          <TableRow key={r}>
            {Array.from({ length: columns }).map((__, c) => <TableCell key={c}><Skeleton variant="text" width={c === 0 ? '70%' : '55%'} /></TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function StatSkeleton() {
  return (
    <Card sx={{ flex: 1, minWidth: 190 }}>
      <CardContent><Skeleton width={90} /><Skeleton variant="text" height={44} width="60%" /></CardContent>
    </Card>
  );
}

export function PageSkeleton() {
  return <Stack spacing={2} aria-busy="true"><Skeleton variant="text" height={42} width={240} /><Skeleton variant="rounded" height={110} /><Skeleton variant="rounded" height={260} /></Stack>;
}
