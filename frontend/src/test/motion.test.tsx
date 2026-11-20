import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QuerySuccessBanner } from '../components/motion/DbSuccess';
import FlowConnector, { flowStateOf } from '../components/motion/FlowConnector';
import PipelineBar from '../components/motion/PipelineBar';

describe('database motion', () => {
  it('shows rows returned for a read and rows affected for a write', async () => {
    const { rerender } = render(<QuerySuccessBanner rowCount={1284} durationMs={42} runKey={1} />);
    expect(screen.getByRole('status').textContent).toMatch(/Query completed/);
    expect(screen.getByTestId('db-success-icon')).toBeTruthy();
    rerender(<QuerySuccessBanner rowCount={0} affectedRows={3} durationMs={1500} runKey={2} />);
    expect(screen.getByRole('status').textContent).toMatch(/Changes applied/);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3\s*rows affected in 1.50 s/));
  });
  it('maps step statuses to connector states', () => {
    expect(flowStateOf('RUNNING')).toBe('running');
    expect(flowStateOf('SUCCESS')).toBe('done');
    expect(flowStateOf('NO_DATA')).toBe('done');
    expect(flowStateOf('FAILED')).toBe('failed');
    expect(flowStateOf('PENDING')).toBe('idle');
    expect(flowStateOf(undefined)).toBe('idle');
  });
  it('renders travelling dots only while running or done', () => {
    const { container, rerender } = render(<FlowConnector state="running" />);
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(2);
    rerender(<FlowConnector state="failed" />);
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(0);
  });
});

describe('pipeline bar', () => {
  it('shows one node per step in the matching state', () => {
    render(<PipelineBar steps={[{ order: 1, name: 'a', status: 'SUCCESS' }, { order: 2, name: 'b', status: 'RUNNING' }, { order: 3, name: 'c', status: 'FAILED' }, { order: 4, name: 'd', status: 'PENDING' }]} />);
    expect(screen.getByTestId('pipe-node-1').className).toContain('pipe-ok');
    expect(screen.getByTestId('pipe-node-2').className).toContain('pipe-run');
    expect(screen.getByTestId('pipe-node-3').className).toContain('pipe-bad');
    expect(screen.getByTestId('pipe-node-4').className).toContain('pipe-idle');
  });
});

describe('pipeline bar for waiting and paused steps', () => {
  it('shows a waiting step as active and a paused step as a warning', () => {
    render(<PipelineBar steps={[{ order: 1, name: 'a', status: 'WAITING' }, { order: 2, name: 'b', status: 'PAUSED' }]} />);
    expect(screen.getByTestId('pipe-node-1').className).toContain('pipe-run');
    expect(screen.getByTestId('pipe-node-2').className).toContain('pipe-warn');
  });
});

import userEvent from '@testing-library/user-event';
import ResultTable from '../components/ResultTable';
describe('editing a result cell', () => {
  it('double-click edits, the Save button submits the new text and closes the editor, Esc cancels, and plain tables are not editable', async () => {
    const edits: unknown[][] = [];
    const cols = [{ name: 'id', type: 'BIGINT' }, { name: 'contribution_date', type: 'DATE' }];
    const { rerender } = render(<ResultTable columns={cols} rows={[[6651, '2027-02-01']]} onEditCell={(r, c, v) => { edits.push([r, c, v]); }} />);
    await userEvent.dblClick(screen.getByText('2027-02-01'));
    const box = screen.getByLabelText('edit contribution_date');
    await userEvent.clear(box);
    await userEvent.type(box, '2026-12-15');
    await userEvent.click(screen.getByLabelText('save cell'));
    expect(edits).toEqual([[0, 'contribution_date', '2026-12-15']]);
    expect(screen.queryByLabelText('edit contribution_date')).toBeNull();
    await userEvent.dblClick(screen.getByText('2027-02-01'));
    await userEvent.type(screen.getByLabelText('edit contribution_date'), '9{Escape}');
    expect(edits).toHaveLength(1);
    rerender(<ResultTable columns={cols} rows={[[6651, '2027-02-01']]} />);
    await userEvent.dblClick(screen.getByText('2027-02-01'));
    expect(screen.queryByLabelText('edit contribution_date')).toBeNull();
  });
});
