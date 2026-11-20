import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkflowRunner from '../components/WorkflowRunner';
import { api } from '../services/api';
import type { RunForm, RunView, Workflow } from '../types';

vi.mock('../services/api', async (orig) => {
  const actual = await orig<typeof import('../services/api')>();
  return { ...actual, api: { startRun: vi.fn(), executeOnRun: vi.fn(), getRun: vi.fn(), stopRun: vi.fn(), workflowRunForm: vi.fn(), saveInputDefaults: vi.fn() } };
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
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.workflowRunForm).mockResolvedValue({ inputs: [], steps: [] }); });

  it('does not refuse to run when required inputs are empty: it only says which steps will be blocked', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run({ status: 'PARTIAL' }));
    render(<WorkflowRunner workflow={wf} />);
    expect(screen.getByText(/No value for required inputs: Customer ID, Contributor ID/)).toBeInTheDocument();
    expect(screen.getByText(/only the steps that need them are blocked/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Run workflow' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, {}, {}, []));
  });

  it('starts a run with the entered inputs and shows mapped values passed between steps', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run());
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.type(screen.getByTestId('field-customerId'), 'C1');
    await userEvent.type(screen.getByTestId('field-contributorId'), 'CT7');
    await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
    expect(await screen.findByText('No records found for the given input(s).')).toBeInTheDocument();
    expect(screen.getByText(/step 2 returned no records/)).toBeInTheDocument();
  });

  it('sends a manual override when running a single step', async () => {
    vi.mocked(api.startRun).mockResolvedValue(run());
    vi.mocked(api.executeOnRun).mockResolvedValue(run());
    render(<WorkflowRunner workflow={wf} />);
    await userEvent.type(screen.getByTestId('field-customerId'), 'C1');
    await userEvent.type(screen.getByTestId('field-contributorId'), 'CT7');
    await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
    const field = await screen.findByTestId('override-3-client_unique_id');
    await userEvent.clear(field);
    await userEvent.type(field, 'CLIENT-B');
    const buttons = screen.getAllByRole('button', { name: 'Run this step' });
    await userEvent.click(buttons[1]);
    await waitFor(() => expect(api.executeOnRun).toHaveBeenCalledWith('abcdef12-0000', [3], { 3: { client_unique_id: 'CLIENT-B' } }));
  });

  describe('runtime inputs', () => {
    const withDefaults: Workflow = {
      ...wf,
      inputs: [
        { name: 'customerId', label: 'Customer ID', type: 'STRING', required: true, defaultValue: 'C-DEFAULT' },
        { name: 'contributorId', label: 'Contributor ID', type: 'STRING', required: false },
        { name: 'when', label: 'When', type: 'DATE', required: false },
        { name: 'dryRun', label: 'Dry run', type: 'BOOLEAN', required: false },
      ],
    };
    const form: RunForm = {
      inputs: [],
      steps: [
        { order: 2, name: 'Fetch contributor', stepType: 'QUERY', params: [
          { name: 'contributor', label: 'Contributor', type: 'STRING', required: true, sourceKind: 'WORKFLOW_INPUT', source: "Workflow input 'contributorId'", inputRef: 'contributorId' },
          { name: 'since', label: 'Since', type: 'DATE', required: false, sourceKind: 'NONE', source: 'Not provided' },
          { name: 'limit', label: 'Limit', type: 'INTEGER', required: false, defaultValue: '25', sourceKind: 'DEFAULT', source: 'Default value' },
          { name: 'flag', label: 'Flag', type: 'BOOLEAN', required: false, sourceKind: 'NONE', source: 'Not provided' }] },
        { order: 3, name: 'Fetch debit instruction', stepType: 'QUERY', params: [
          { name: 'client_unique_id', label: 'Client', type: 'STRING', required: true, sourceKind: 'AUTOMATIC', source: 'Step 2 -> clientUniqueId' },
          { name: 'note', label: 'Note', type: 'STRING', required: true, sourceKind: 'NONE', source: 'Not provided' }] },
      ],
    };
    const wfForm: Workflow = { ...withDefaults, steps: [
      { ...wf.steps[0], mappings: [...wf.steps[0].mappings, { paramName: 'since', sourceType: 'CONSTANT', constantValue: '' }] },
      wf.steps[1]] };

    it('prefills workflow-input defaults, lets typed values win and treats a default as not missing', async () => {
      vi.mocked(api.startRun).mockResolvedValue(run());
      render(<WorkflowRunner workflow={withDefaults} />);
      expect(screen.getByTestId('field-customerId')).toHaveValue('C-DEFAULT');
      expect(screen.getByText(/Default: C-DEFAULT/)).toBeInTheDocument();
      expect(screen.queryByText(/No value for required input/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
      await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, { customerId: 'C-DEFAULT' }, {}, []));
      await userEvent.clear(screen.getByTestId('field-customerId'));
      await userEvent.type(screen.getByTestId('field-customerId'), 'C-TYPED');
      await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
      await waitFor(() => expect(api.startRun).toHaveBeenLastCalledWith(1, { customerId: 'C-TYPED' }, {}, []));
    });

    it('supports text, number, date and yes/no inputs and an empty optional value', async () => {
      vi.mocked(api.startRun).mockResolvedValue(run());
      render(<WorkflowRunner workflow={withDefaults} />);
      expect(screen.getByTestId('field-when')).toHaveAttribute('type', 'date');
      await userEvent.type(screen.getByTestId('field-when'), '2026-05-05');
      await userEvent.click(screen.getByRole('checkbox', { name: 'Dry run' }));
      await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
      // contributorId was left empty (optional): it is simply not sent
      await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, { customerId: 'C-DEFAULT', when: '2026-05-05', dryRun: 'true' }, {}, []));
    });

    it('saves typed values as defaults only when asked to', async () => {
      vi.mocked(api.saveInputDefaults).mockResolvedValue(undefined);
      render(<WorkflowRunner workflow={withDefaults} />);
      await userEvent.type(screen.getByTestId('field-contributorId'), 'CT-9');
      expect(api.saveInputDefaults).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Save as defaults' }));
      await waitFor(() => expect(api.saveInputDefaults).toHaveBeenCalledWith(1, { customerId: 'C-DEFAULT', contributorId: 'CT-9' }));
    });

    it('shows where each step value comes from before anything runs, with typed override fields and required marks', async () => {
      vi.mocked(api.workflowRunForm).mockResolvedValue(form);
      render(<WorkflowRunner workflow={wfForm} />);
      expect(await screen.findByText('Automatic · Step 2 -> clientUniqueId')).toBeInTheDocument();
      expect(screen.getByText("Workflow input 'contributorId'")).toBeInTheDocument();
      expect(screen.getByText('Default value')).toBeInTheDocument();
      expect(screen.getByText('Required: nothing provides it yet')).toBeInTheDocument();
      expect(screen.getAllByText('Optional: left empty')).toHaveLength(2);
      expect(screen.getByTestId('override-2-since')).toHaveAttribute('type', 'date');
      expect(screen.getByTestId('override-2-limit')).toHaveAttribute('placeholder', '25');
      expect(screen.getByTestId('override-3-client_unique_id')).toHaveAttribute('placeholder', 'automatic');
    });

    it('sends typed overrides for this run only and an untouched optional field sends nothing', async () => {
      vi.mocked(api.workflowRunForm).mockResolvedValue(form);
      vi.mocked(api.startRun).mockResolvedValue(run());
      render(<WorkflowRunner workflow={wfForm} />);
      await userEvent.type(await screen.findByTestId('override-2-limit'), '50');
      await userEvent.type(screen.getByTestId('override-3-note'), 'hello');
      await userEvent.click(screen.getByRole('button', { name: 'Run workflow' }));
      await waitFor(() => expect(api.startRun).toHaveBeenCalledWith(1, { customerId: 'C-DEFAULT' }, { 2: { limit: '50' }, 3: { note: 'hello' } }, []));
      expect(api.saveInputDefaults).not.toHaveBeenCalled();
    });
  });
});
