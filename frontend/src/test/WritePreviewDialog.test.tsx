import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WritePreviewDialog from '../components/WritePreviewDialog';
import type { WritePreview } from '../types';

const base: WritePreview = {
  statementType: 'UPDATE', sql: 'UPDATE t SET d = ? WHERE id = ?', params: ['2025-01-01', '7'], affectedRows: 1,
  columns: [{ name: 'id', type: 'BIGINT' }, { name: 'd', type: 'DATE' }], targetRows: [[7, '2024-01-01']],
  proposedChanges: [{ column: 'd', expression: '?', newValue: '2025-01-01' }], previewDerived: true, maxAffectedRows: 10,
  withinLimit: true, executable: true, confirmationToken: 'tok', warnings: [],
};

describe('WritePreviewDialog', () => {
  it('shows target rows and proposed changes and requires an explicit confirm click', async () => {
    const onConfirm = vi.fn();
    render(<WritePreviewDialog preview={base} onConfirm={onConfirm} onClose={() => {}} />);
    expect(screen.getByTestId('affected-count')).toHaveTextContent('1');
    expect(screen.getByText('2024-01-01')).toBeInTheDocument();
    expect(screen.getAllByText('2025-01-01').length).toBeGreaterThan(0);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /confirm and execute/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('blocks confirmation when read-only or over the limit', () => {
    render(<WritePreviewDialog preview={{ ...base, executable: false, withinLimit: false, affectedRows: 50, blockedReason: 'Statement would affect 50 rows', confirmationToken: null }} onConfirm={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /confirm and execute/i })).toBeDisabled();
    expect(screen.getByText(/would affect 50 rows/)).toBeInTheDocument();
  });
});
