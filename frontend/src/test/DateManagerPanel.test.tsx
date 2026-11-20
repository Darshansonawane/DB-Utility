import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DateManagerPanel from '../components/DateManagerPanel';

describe('DateManagerPanel', () => {
  const now = new Date(2024, 4, 20);
  it('shows existing, proposed and original dates and previews each source', async () => {
    render(<DateManagerPanel now={now} existing={[{ label: 'Step 4 · contribution_date', value: '2024-05-01' }]} originalScheduledDate="2024-04-10" />);
    expect(screen.getByTestId('existing-date')).toHaveTextContent('2024-05-01');
    expect(screen.getByTestId('original-date')).toHaveTextContent('2024-04-10');
    expect(screen.getByTestId('proposed-date')).toHaveTextContent('2024-05-20');
    await userEvent.click(screen.getByLabelText('One Month Back'));
    expect(screen.getByTestId('proposed-date')).toHaveTextContent('2024-04-20');
    await userEvent.click(screen.getByLabelText('Original Scheduled Date'));
    expect(screen.getByTestId('proposed-date')).toHaveTextContent('2024-04-10');
    await userEvent.click(screen.getByLabelText('Previous Date (yesterday)'));
    expect(screen.getByTestId('proposed-date')).toHaveTextContent('2024-05-19');
  });

  it('disables the original-date source until it has been captured and never offers an apply action', () => {
    render(<DateManagerPanel now={now} existing={[]} originalScheduledDate={null} />);
    expect(screen.getByLabelText('Original Scheduled Date')).toBeDisabled();
    expect(screen.getByTestId('original-date')).toHaveTextContent('not captured yet');
    expect(screen.queryByRole('button', { name: /apply|execute|update/i })).not.toBeInTheDocument();
  });
});
