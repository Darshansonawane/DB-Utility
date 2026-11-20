import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkflowRunner from '../components/WorkflowRunner';
import { api } from '../services/api';
import type { RunView, Workflow } from '../types';

vi.mock('../services/api', async (orig) => {
  const actual = await orig<typeof import('../services/api')>();
  return { ...actual, api: { startRun: vi.fn(), executeOnRun: vi.fn(), getRun: vi.fn(), stopRun: vi.fn() } };
});

const wf: Workflow = {
  id: 1, name: 'WF', inputs: [
    { name: 'customerId', label: 'Customer ID', type: 'STRING', required: true },
    { name: 'contributorId', label: 'Contributor ID', type: 'STRING', required: true }],
  steps: [
    { order: 2, name: 'Fetch contributor', queryId: 2, dependsOn: [], retryCount: 0, retryDelayMs: 0, stopOnFailure: false, outputFields: [{ alias: 'clientUniqueId', column: 'client_unique_id' }],
      mappings: [{ paramName: 'contributor', sourceType: 'INPUT', sourceRef: 'contributorId' }] },
    { order: 3, name: 'Fetch debit instruction', queryId: 3, dependsOn: [2], retryCount: 0, retryDelayMs: 0, stopOnFailure: false, outputFields: [],
      mappings: [{ paramName: 'client_unique_id', sourceType: 'STEP_OUTPUT', sourceRef: '2', sourceField: 'clientUniqueId' }] },
  ],
};

const run = (overrides: Partial<RunView> = {}): RunView => ({
  runId: 'abcdef12-0000', workflowId: 1, workflowName: 'WF', status: 'SUCCESS', startedAt: '', durationMs: 12, inputs: { customerId: 'C1', contributorId: 'CT7' },
  steps: [
    { order: 2, name: 'Fetch contributor', status: 'SUCCESS', durationMs: 4, attempts: 1, params: { contributor: 'CT7' }, paramSources: { contributor: "Workflow input 'contributorId'" },
      outputs: { clientUniqueId: 'CLIENT-A' }, result: { columns: [{ name: 'client_unique_id', type: 'VARCHAR' }], rows: [['CLIENT-A']], truncated: false, rowCount: 1, durationMs: 4, statementType: 'SELECT' } },
    { order: 3, name: 'Fetch debit instruction', status: 'SUCCESS', durationMs: 3, attempts: 1, params: { client_unique_id: 'CLIENT-A' }, paramSources: { client_unique_id: 'Step 2 -> clientUniqueId' }, outputs: {},
      result: { columns: [{ name: 'status', type: 'VARCHAR' }], rows: [['PENDING']], truncated: false, rowCount: 1, durationMs: 3, statementType: 'SELECT' } },
  ], ...overrides,
});

describe('WorkflowRunner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires the initial inputs before running', async () => {
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fetch All Details' }));
    expect(await screen.findByText(/Required: Customer ID, Contributor ID/)).toBeInTheDocument();
    expect(api.startRun).not.toHaveBeenCalled();
  });

  it('starts a run with the entered inputs and shows mapped values passed between steps', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run());
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.type(screen.getByTestId('field-customerId'), 'C1');
    await userEvent.type(screen.getByTestId('field-contributorId'), 'CT7');
    await userEvent.click(screen.getByRole('button', { name: 'Fetch All Details' }));
    await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, { customerId: 'C1', contributorId: 'CT7' }, {}, []));
    expect(await screen.findByDisplayValue('CLIENT-A')).toBeInTheDocument(); // step 3 input populated from step 2
    expect(screen.getByText('Step 2 -> clientUniqueId')).toBeInTheDocument();
    expect(screen.getByText('clientUniqueId: CLIENT-A')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument(); // result cell
  });

  it('shows missing records and blocked steps clearly', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run({
      status: 'PARTIAL', steps: [
        { order: 2, name: 'Fetch contributor', status: 'NO_DATA', durationMs: 2, attempts: 1, params: { contributor: 'X' }, paramSources: {}, outputs: {}, result: { columns: [], rows: [], truncated: false, rowCount: 0, durationMs: 2, statementType: 'SELECT' } },
        { order: 3, name: 'Fetch debit instruction', status: 'BLOCKED', durationMs: 0, attempts: 0, params: {}, paramSources: {}, outputs: {}, error: 'Missing required value(s) - Client Unique ID: step 2 returned no records' },
      ],
    }));
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.type(screen.getByTestId('field-customerId'), 'C1');
    await userEvent.type(screen.getByTestId('field-contributorId'), 'X');
    await userEvent.click(screen.getByRole('button', { name: 'Fetch All Details' }));
    expect(await screen.findByText('No records found for the given input(s).')).toBeInTheDocument();
    expect(screen.getByText(/step 2 returned no records/)).toBeInTheDocument();
  });

  it('sends a manual override when running a single step', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run());
    vi.mocked(api.executeOnRun).mockResolvedValue(run());
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.type(screen.getByTestId('field-customerId'), 'C1');
    await userEvent.type(screen.getByTestId('field-contributorId'), 'CT7');
    await userEvent.click(screen.getByRole('button', { name: 'Fetch All Details' }));
    const field = await screen.findByTestId('override-3-client_unique_id');
    await userEvent.clear(field);
    await userEvent.type(field, 'CLIENT-B');
    const buttons = screen.getAllByRole('button', { name: 'Run this step' });
    await userEvent.click(buttons[1]);
    await waitFor(() => expect(api.executeOnRun).toHaveBeenCalledWith('abcdef12-0000', [3], { 3: { client_unique_id: 'CLIENT-B' } }));
  });
});
