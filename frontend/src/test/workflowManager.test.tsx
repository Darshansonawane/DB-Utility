import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, Project, Workflow } from '../types';

vi.mock('../services/api', () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  errStatus: () => undefined,
  api: {
    projects: vi.fn(), folders: vi.fn(), workflows: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(), deleteProject: vi.fn(), createFolder: vi.fn(),
    updateFolder: vi.fn(), deleteFolder: vi.fn(), moveWorkflow: vi.fn(), deleteWorkflow: vi.fn(), queries: vi.fn(), apiRequests: vi.fn(),
  },
}));
import { api } from '../services/api';
import WorkflowManager from '../pages/WorkflowManager';
import { NotifierProvider } from '../components/Notifier';
import { FOLDER_DRAG, WORKFLOW_DRAG } from '../components/projects/workflowHierarchy';

const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const H = 3_600_000;

const projects: Project[] = [
  { id: 1, name: 'Savings Wallet', description: 'Wallet and goals', folderCount: 3, workflowCount: 4, updatedAt: ago(2 * H) },
  { id: 2, name: 'HelloBank', description: 'Retail app', folderCount: 0, workflowCount: 1, updatedAt: ago(30 * H) },
  { id: 3, name: 'Fraud Engine', description: '', folderCount: 0, workflowCount: 0, updatedAt: ago(90 * H) },
];
const folders: Folder[] = [
  { id: 10, kind: 'WORKFLOW', parentId: 0, name: 'E2E Automation', projectId: 1 },
  { id: 11, kind: 'WORKFLOW', parentId: 10, name: 'Regression', projectId: 1 },
  { id: 12, kind: 'WORKFLOW', parentId: 0, name: 'Micro flows', projectId: 1 },
];
const wf = (o: Partial<Workflow> & { id: number; name: string }): Workflow => ({ inputs: [], steps: [], folderId: 0, projectId: 1, ...o });
const workflows: Workflow[] = [
  wf({ id: 1, name: 'Create wallet', description: 'Creates a savings wallet through the API', folderId: 10, lastStatus: 'SUCCESS', lastRunAt: ago(2 * H), updatedAt: ago(5 * H),
    steps: [{ order: 1, name: 'Call API', stepType: 'API_REQUEST', queryId: 0, dependsOn: [], retryCount: 0, retryDelayMs: 0, stopOnFailure: false, outputFields: [], mappings: [] }] }),
  wf({ id: 2, name: 'Goal reached', folderId: 11, lastStatus: 'FAILED', lastRunAt: ago(3 * H), updatedAt: ago(1 * H) }),
  wf({ id: 3, name: 'Top level flow', folderId: 0, updatedAt: ago(500 * H) }),
  wf({ id: 4, name: 'Token helper', folderId: 12, lastStatus: 'SUCCESS', lastRunAt: ago(50 * H), updatedAt: ago(60 * H) }),
  wf({ id: 5, name: 'Login', projectId: 2, folderId: 0, lastStatus: 'SUCCESS', lastRunAt: ago(1 * H), updatedAt: ago(2 * H) }),
];

function page(path = '/workflows') {
  return render(<NotifierProvider><MemoryRouter initialEntries={[path]}><WorkflowManager /></MemoryRouter></NotifierProvider>);
}
const dt = (type: string, id: number) => ({ types: [type], getData: (t: string) => (t === type ? String(id) : ''), setData: vi.fn(), effectAllowed: '' });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() });
  m.projects.mockResolvedValue(projects);
  m.folders.mockResolvedValue(folders);
  m.workflows.mockResolvedValue(workflows);
  m.queries.mockResolvedValue([]);
  m.apiRequests.mockResolvedValue([]);
  for (const k of ['createProject', 'updateProject', 'deleteProject', 'createFolder', 'updateFolder', 'deleteFolder', 'moveWorkflow', 'deleteWorkflow']) m[k].mockResolvedValue({});
});

describe('Projects level', () => {
  it('shows project cards with folder and workflow counts and last updated', async () => {
    page();
    const card = await screen.findByRole('button', { name: 'open project Savings Wallet' });
    expect(within(card).getByText('3 folders')).toBeInTheDocument();
    expect(within(card).getByText('4 workflows')).toBeInTheDocument();
    expect(within(card).getByText(/Updated 2 h ago/)).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'open project HelloBank' })).getByText('1 workflow')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'open project Fraud Engine' })).getByText('0 workflows')).toBeInTheDocument();
  });

  it('keeps New workflow disabled until a project is open, then enables it', async () => {
    page();
    await screen.findByRole('button', { name: 'open project Savings Wallet' });
    expect(screen.getByRole('button', { name: /New workflow/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'open project Savings Wallet' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /New workflow/ })).toBeEnabled());
  });

  it('shows a friendly empty state when there are no projects', async () => {
    m.projects.mockResolvedValue([]); m.folders.mockResolvedValue([]); m.workflows.mockResolvedValue([]);
    page();
    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
  });

  it('creates a project and opens it', async () => {
    m.createProject.mockResolvedValue({ id: 9, name: 'Payments' });
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Payments');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(m.createProject).toHaveBeenCalledWith('Payments', ''));
  });
});

describe('Folders and workflows levels', () => {
  it('opens a project to its folders, then a folder to its workflows, with breadcrumbs and Back', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'open project Savings Wallet' }));
    expect(await screen.findByRole('button', { name: 'open folder E2E Automation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open folder Micro flows' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'open folder Regression' })).not.toBeInTheDocument();
    expect(screen.getByText('Top level flow')).toBeInTheDocument();
    expect(screen.queryByText('Login')).not.toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'location' });
    expect(within(crumbs).getByText('All Projects')).toBeInTheDocument();
    expect(within(crumbs).getByText('Workflows')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'open folder E2E Automation' }));
    expect(await screen.findByText('Create wallet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open folder Regression' })).toBeInTheDocument();
    expect(screen.queryByText('Top level flow')).not.toBeInTheDocument();
    const trail = screen.getByRole('navigation', { name: 'location' });
    expect(within(trail).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['All Projects', 'Savings Wallet', 'E2E Automation']);

    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(await screen.findByText('Top level flow')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    expect(await screen.findByRole('button', { name: 'open project HelloBank' })).toBeInTheDocument();
  });

  it('shows name, step count, last execution status and the Run / Edit / Move / Delete actions on a workflow', async () => {
    page('/workflows?project=1&folder=10');
    const card = await screen.findByTestId('workflow-1');
    expect(within(card).getByText('Create wallet')).toBeInTheDocument();
    expect(within(card).getByText('Creates a savings wallet through the API')).toBeInTheDocument();
    expect(within(card).getByText('1 step')).toBeInTheDocument();
    expect(within(card).getByText(/Succeeded · 2 h ago/)).toBeInTheDocument();
    for (const name of ['Run', 'Edit']) expect(within(card).getByRole('button', { name })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'move Create wallet' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'delete Create wallet' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'open folder Regression' }));
    const failed = await screen.findByTestId('workflow-2');
    expect(within(failed).getByText(/Failed · 3 h ago/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    await userEvent.click(await screen.findByRole('button', { name: 'open folder Micro flows' }));
    await screen.findByTestId('workflow-4');
  });

  it('shows "Never run" for a workflow that was never executed, and an empty state for an empty project', async () => {
    page('/workflows?project=1');
    expect(within(await screen.findByTestId('workflow-3')).getByText('Never run')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'back' }));
    await userEvent.click(await screen.findByRole('button', { name: 'open project Fraud Engine' }));
    expect(await screen.findByText('This project is empty')).toBeInTheDocument();
  });

  it('honours the address bar, so deep links work', async () => {
    page('/workflows?project=1&folder=11');
    expect(await screen.findByTestId('workflow-2')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-1')).not.toBeInTheDocument();
  });
});

describe('search and filters', () => {
  it('searches projects, folders, workflow names and descriptions across the whole hierarchy', async () => {
    page();
    await screen.findByRole('button', { name: 'open project Savings Wallet' });
    await userEvent.type(screen.getByLabelText('Search workflows'), 'wallet');
    expect(await screen.findByText('Projects · 1')).toBeInTheDocument();
    expect(screen.getByText('Workflows · 1')).toBeInTheDocument();
    expect(screen.getByTestId('workflow-1')).toHaveTextContent('Savings Wallet › E2E Automation');
    await userEvent.clear(screen.getByLabelText('Search workflows'));
    await userEvent.type(screen.getByLabelText('Search workflows'), 'regress');
    expect(await screen.findByText('Folders · 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'open folder Regression' })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search workflows'));
    await userEvent.type(screen.getByLabelText('Search workflows'), 'through the api');
    expect(await screen.findByTestId('workflow-1')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search workflows'));
    await userEvent.type(screen.getByLabelText('Search workflows'), 'nothing like this');
    expect(await screen.findByText('Nothing matches')).toBeInTheDocument();
  });

  it('filters by execution status and recency together with search, without reloading', async () => {
    page();
    await screen.findByRole('button', { name: 'open project Savings Wallet' });
    const calls = m.workflows.mock.calls.length;
    await userEvent.click(screen.getByLabelText('Execution status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Last run failed' }));
    expect(await screen.findByTestId('workflow-2')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Execution status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Never run' }));
    expect(await screen.findByTestId('workflow-3')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Execution status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Last run succeeded' }));
    await userEvent.click(screen.getByLabelText('Recently executed'));
    await userEvent.click(await screen.findByRole('option', { name: 'Last 24 hours' }));
    await waitFor(() => expect(screen.getAllByTestId(/^workflow-/).map((e) => e.getAttribute('data-testid'))).toEqual(['workflow-1', 'workflow-5']));
    await userEvent.type(screen.getByLabelText('Search workflows'), 'login');
    await waitFor(() => expect(screen.getAllByTestId(/^workflow-/).map((e) => e.getAttribute('data-testid'))).toEqual(['workflow-5']));
    expect(m.workflows.mock.calls.length).toBe(calls);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await screen.findByRole('button', { name: 'open project HelloBank' });
  });

  it('the project filter limits the view to that project', async () => {
    page();
    await screen.findByRole('button', { name: 'open project Savings Wallet' });
    await userEvent.click(screen.getByLabelText('Project'));
    await userEvent.click(await screen.findByRole('option', { name: 'HelloBank' }));
    expect(await screen.findByTestId('workflow-5')).toBeInTheDocument();
    expect(screen.queryByTestId('workflow-1')).not.toBeInTheDocument();
  });
});

describe('moving, renaming and deleting', () => {
  it('moves a workflow into a folder by dragging it onto the folder', async () => {
    page('/workflows?project=1');
    const card = await screen.findByTestId('workflow-3');
    const target = screen.getByRole('button', { name: 'open folder E2E Automation' });
    fireEvent.dragStart(card, { dataTransfer: dt(WORKFLOW_DRAG, 3) });
    fireEvent.dragOver(target, { dataTransfer: dt(WORKFLOW_DRAG, 3) });
    fireEvent.drop(target, { dataTransfer: dt(WORKFLOW_DRAG, 3) });
    await waitFor(() => expect(m.moveWorkflow).toHaveBeenCalledWith(3, 10, undefined));
  });

  it('moves a folder under another folder by dragging, but refuses to move it into another project', async () => {
    page('/workflows?project=1');
    const micro = await screen.findByRole('button', { name: 'open folder Micro flows' });
    const e2e = screen.getByRole('button', { name: 'open folder E2E Automation' });
    fireEvent.drop(e2e, { dataTransfer: dt(FOLDER_DRAG, 12) });
    await waitFor(() => expect(m.updateFolder).toHaveBeenCalledWith(12, { parentId: 10 }));
    m.updateFolder.mockClear();
    fireEvent.drop(micro, { dataTransfer: dt(FOLDER_DRAG, 12) }); // onto itself: ignored
    fireEvent.drop(screen.getByRole('button', { name: 'tree project HelloBank' }), { dataTransfer: dt(FOLDER_DRAG, 12) });
    await new Promise((r) => setTimeout(r, 50));
    expect(m.updateFolder).not.toHaveBeenCalled();
  });

  it('moves a workflow to another project from the Move dialog', async () => {
    page('/workflows?project=1');
    await userEvent.click(await screen.findByRole('button', { name: 'move Top level flow' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Project'));
    await userEvent.click(await screen.findByRole('option', { name: 'HelloBank' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(m.moveWorkflow).toHaveBeenCalledWith(3, 0, 2));
  });

  it('asks for confirmation, with real counts, before deleting a folder that holds workflows', async () => {
    page('/workflows?project=1');
    await userEvent.click(await screen.findByRole('button', { name: 'actions for folder E2E Automation' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 workflows');
    expect(dialog).toHaveTextContent('1 subfolder');
    expect(dialog).toHaveTextContent('not');
    const confirm = within(dialog).getByRole('button', { name: 'Delete folder' });
    expect(confirm).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox'));
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() => expect(m.deleteFolder).toHaveBeenCalledWith(10));
  });

  it('deletes an empty folder without the extra acknowledgement', async () => {
    m.workflows.mockResolvedValue(workflows.filter((w) => w.folderId !== 12));
    page('/workflows?project=1');
    await userEvent.click(await screen.findByRole('button', { name: 'actions for folder Micro flows' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    await waitFor(() => expect(m.deleteFolder).toHaveBeenCalledWith(12));
  });

  it('only deletes a non-empty project by moving its contents to another project', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'actions for project Savings Wallet' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('4 workflows and 3 folders');
    expect(dialog).toHaveTextContent('Nothing is deleted with it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move contents and delete' }));
    await waitFor(() => expect(m.deleteProject).toHaveBeenCalledWith(1, 2));
  });

  it('deletes an empty project directly and renames a project', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'actions for project Fraud Engine' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(m.deleteProject).toHaveBeenCalledWith(3, undefined));
    await userEvent.click(await screen.findByRole('button', { name: 'actions for project HelloBank' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename / edit' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('Project name');
    await userEvent.clear(name);
    await userEvent.type(name, 'HelloBank Retail');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.updateProject).toHaveBeenCalledWith(2, 'HelloBank Retail', 'Retail app'));
  });

  it('creates a folder inside the current project and folder', async () => {
    page('/workflows?project=1&folder=10');
    await userEvent.click(await screen.findByRole('button', { name: /New folder here/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Folder name'), 'Smoke');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.createFolder).toHaveBeenCalledWith('WORKFLOW', 10, 'Smoke', 1));
  });
});

describe('navigation tree', () => {
  it('lists projects and folders and navigates when clicked', async () => {
    page();
    const tree = await screen.findByRole('navigation', { name: 'projects and folders' });
    expect(within(tree).getByText('Savings Wallet')).toBeInTheDocument();
    expect(within(tree).getByText('HelloBank')).toBeInTheDocument();
    await userEvent.click(within(tree).getByRole('button', { name: 'expand Savings Wallet' }));
    await userEvent.click(await within(tree).findByRole('button', { name: 'tree folder E2E Automation' }));
    expect(await screen.findByTestId('workflow-1')).toBeInTheDocument();
  });
});
