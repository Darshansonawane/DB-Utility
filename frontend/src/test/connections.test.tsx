import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionView } from '../types';

vi.mock('../services/api', () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  errStatus: (e: { status?: number }) => e?.status,
  api: {
    connections: vi.fn(), statuses: vi.fn(), connect: vi.fn(), testConnection: vi.fn(), setAccessPassword: vi.fn(), deleteConnection: vi.fn(),
    createConnection: vi.fn(), updateConnection: vi.fn(), testConnectionDraft: vi.fn(), disconnectOne: vi.fn(), activateConnection: vi.fn(),
    openVpn: vi.fn(), databases: vi.fn(), useDatabase: vi.fn(),
  },
}));
import { api } from '../services/api';
import Connections from '../pages/Connections';
import DatabaseSelect from '../components/DatabaseSelect';
import { NotifierProvider } from '../components/Notifier';

const conn = (o: Partial<ConnectionView> & { id: number; name: string }): ConnectionView => ({
  environment: 'QA', dbType: 'MYSQL', host: '10.0.0.1', port: 3306, databaseName: null, username: 'darshan', tls: false, usesUri: false,
  ownerName: 'Darshan', passwordProtected: true, connected: false, active: false, ...o,
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;
const page = () => render(<NotifierProvider><Connections /></NotifierProvider>);
const ALL = [
  conn({ id: 1, name: 'Savings_Wallet', host: '10.111.111.145' }),
  conn({ id: 2, name: 'Savings_Wallet_staging', host: '172.19.0.83', environment: 'STAGING', ownerName: 'Rahul' }),
  conn({ id: 3, name: 'MongoDB_QA', dbType: 'MONGODB', host: '10.111.111.114', port: 27017 }),
  conn({ id: 4, name: 'Customer_Dev', dbType: 'MONGODB', host: 'mongo.dev', port: 27017, environment: 'DEV' }),
];
const names = () => screen.queryAllByTestId(/^conn-/).map((r) => r.querySelector('td p')?.textContent);
const toastOf = async (text: string | RegExp) => (await screen.findByText(text)).closest('.MuiAlert-root') as HTMLElement;
const reject = (message: string, status: number) => Object.assign(new Error(message), { status });

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear(),
  });
  m.statuses.mockResolvedValue([]);
  m.databases.mockResolvedValue({ databases: ['bank_wallet', 'bank_audit'], selected: null, restricted: false });
  m.connections.mockResolvedValue(ALL);
});

describe('Connections table', () => {
  it('shows exactly the requested columns: no Network and no Database column', async () => {
    page();
    await screen.findByText('Savings_Wallet');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Connection Name', 'Database Type', 'Environment', 'Host', 'Username', 'Owner', 'Connection Status', 'Actions']);
    expect(screen.queryByText('Network')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Database' })).not.toBeInTheDocument();
  });

  it('labels environments QA, Staging and Development (never UAT) and keeps every action', async () => {
    page();
    await screen.findByText('Savings_Wallet');
    const row = screen.getByTestId('conn-2');
    expect(within(row).getAllByText('Staging').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('conn-4')).getAllByText('Development').length).toBeGreaterThan(0);
    expect(screen.queryByText('UAT')).not.toBeInTheDocument();
    for (const name of ['Test', 'Connect']) expect(within(row).getByRole('button', { name })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'edit' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'delete' })).toBeInTheDocument();
  });

  it('shows total and connected counts', async () => {
    m.connections.mockResolvedValue([...ALL.slice(0, 3), conn({ id: 4, name: 'Customer_Dev', connected: true, active: true })]);
    page();
    expect(await screen.findByText('Total 4')).toBeInTheDocument();
    expect(screen.getByText('Connected 1')).toBeInTheDocument();
  });
});

describe('search, filters, sort and grouping', () => {
  it('searches across name, host, username and owner without calling the API again', async () => {
    page();
    await screen.findByText('Savings_Wallet');
    const calls = m.connections.mock.calls.length;
    await userEvent.type(screen.getByLabelText('Search connections'), 'rahul');
    await waitFor(() => expect(names()).toEqual(['Savings_Wallet_staging']));
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search connections'));
    await userEvent.type(screen.getByLabelText('Search connections'), '10.111.111');
    await waitFor(() => expect(names().sort()).toEqual(['MongoDB_QA', 'Savings_Wallet']));
    expect(m.connections.mock.calls.length).toBe(calls);
  });

  it('combines the type and environment filters with search, and clears them', async () => {
    page();
    await screen.findByText('Savings_Wallet');
    await userEvent.click(screen.getByRole('button', { name: 'MongoDB' }));
    await waitFor(() => expect(names().sort()).toEqual(['Customer_Dev', 'MongoDB_QA']));
    await userEvent.click(screen.getByRole('button', { name: 'Development' }));
    await waitFor(() => expect(names()).toEqual(['Customer_Dev']));
    await userEvent.click(screen.getByRole('button', { name: 'Staging' }));
    expect(await screen.findByText('No connections match your search and filters.')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);
    await waitFor(() => expect(names()).toHaveLength(4));
  });

  it('filters by connected status', async () => {
    m.connections.mockResolvedValue([ALL[0], { ...ALL[1], connected: true }, ALL[2], ALL[3]]);
    page();
    await screen.findByText('Savings_Wallet');
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Connected' }));
    await waitFor(() => expect(names()).toEqual(['Savings_Wallet_staging']));
  });

  it('sorts by recently added and groups by database type with collapsible sections', async () => {
    page();
    await screen.findByText('Savings_Wallet');
    expect(names()).toEqual(['Customer_Dev', 'MongoDB_QA', 'Savings_Wallet', 'Savings_Wallet_staging']);
    await userEvent.click(screen.getByLabelText('Sort by'));
    await userEvent.click(await screen.findByRole('option', { name: 'Recently added' }));
    await waitFor(() => expect(names()[0]).toBe('Customer_Dev'));
    expect(names()).toEqual(['Customer_Dev', 'MongoDB_QA', 'Savings_Wallet_staging', 'Savings_Wallet']);

    await userEvent.click(screen.getByLabelText('Group by'));
    await userEvent.click(await screen.findByRole('option', { name: 'Database type' }));
    const header = await screen.findByRole('row', { name: /^MySQL 2/ });
    expect(screen.getByRole('row', { name: /^MongoDB 2/ })).toBeInTheDocument();
    expect(names()).toHaveLength(4);
    await userEvent.click(header);
    await waitFor(() => expect(names().sort()).toEqual(['Customer_Dev', 'MongoDB_QA']));
    await userEvent.click(header);
    await waitFor(() => expect(names()).toHaveLength(4));
  });

  it('remembers sort, grouping and filters across visits', async () => {
    const first = page();
    await screen.findByText('Savings_Wallet');
    await userEvent.click(screen.getByRole('button', { name: 'MySQL' }));
    await waitFor(() => expect(names()).toHaveLength(2));
    first.unmount();
    page();
    await screen.findByText('Savings_Wallet');
    expect(names().sort()).toEqual(['Savings_Wallet', 'Savings_Wallet_staging']);
  });
});

describe('connect lifecycle and feedback', () => {
  const unlock = async (id: number, password = 'open-sesame') => {
    await userEvent.click(within(await screen.findByTestId(`conn-${id}`)).getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Access password'), password);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    return dialog;
  };

  it('asks for the access password, shows Connecting, then a success toast naming the connection and the databases found', async () => {
    let finish: (v: unknown) => void = () => {};
    m.connect.mockReturnValue(new Promise((r) => { finish = r; }));
    page();
    await screen.findByText('Savings_Wallet');
    await unlock(1);
    expect(m.connect).toHaveBeenCalledWith(1, 'open-sesame');
    expect(await within(screen.getByTestId('conn-1')).findByText('Connecting…')).toBeInTheDocument();
    m.connections.mockResolvedValue([{ ...ALL[0], connected: true, active: true }, ...ALL.slice(1)]);
    await act(async () => { finish({ connected: true, message: 'Connected' }); });
    const toast = await toastOf(/Connected to Savings_Wallet/);
    expect(toast).toHaveTextContent('Connected to Savings_Wallet · 2 databases available');
    const row = screen.getByTestId('conn-1');
    await waitFor(() => expect(within(row).getByText('Connected · active')).toBeInTheDocument());
    expect(row).toHaveClass('row-success');
    expect(within(row).getByText('Connected · active').closest('.MuiChip-root')).toHaveClass('badge-pop');
    expect(m.databases).toHaveBeenCalledWith('MYSQL');
  });

  it('keeps the prompt open with an error when the access password is wrong', async () => {
    m.connect.mockRejectedValue(reject('Incorrect access password for this connection.', 403));
    page();
    await screen.findByText('Savings_Wallet');
    const dialog = await unlock(1, 'guess-1');
    expect(await within(dialog).findByText('Incorrect access password for this connection.')).toBeInTheDocument();
    expect(screen.getByTestId('conn-1')).not.toHaveClass('row-error');
  });

  it('shows a clear error toast, a failed badge and an error flash when the database cannot be reached, without leaking secrets', async () => {
    m.connect.mockRejectedValue(reject('Could not connect: Communications link failure', 400));
    page();
    await screen.findByText('Savings_Wallet');
    await unlock(1, 'open-sesame');
    const toast = await toastOf(/Could not connect to Savings_Wallet/);
    expect(toast).toHaveTextContent('Could not connect to Savings_Wallet: Could not connect: Communications link failure');
    expect(toast).toHaveClass('shake');
    expect(toast.textContent).not.toContain('open-sesame');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const row = screen.getByTestId('conn-1');
    expect(within(row).getByText('Failed')).toBeInTheDocument();
    expect(row).toHaveClass('row-error');
    // and the Failed status filter now finds it
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(await screen.findByRole('option', { name: 'Failed' }));
    await waitFor(() => expect(names()).toEqual(['Savings_Wallet']));
  });

  it('lets the first person choose an access password for an older, unprotected connection', async () => {
    m.connections.mockResolvedValue([{ ...ALL[0], passwordProtected: false }, ...ALL.slice(1)]);
    m.setAccessPassword.mockResolvedValue(ALL[0]);
    m.connect.mockResolvedValue({ connected: true, message: 'Connected' });
    page();
    await userEvent.click(within(await screen.findByTestId('conn-1')).getByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Set an access password/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Access password'), 'chosen-pw');
    await userEvent.type(within(dialog).getByLabelText('Repeat access password'), 'chosen-pw');
    await userEvent.click(within(dialog).getByRole('button', { name: /Set password and connect/ }));
    await waitFor(() => expect(m.setAccessPassword).toHaveBeenCalledWith(1, 'chosen-pw'));
    await waitFor(() => expect(m.connect).toHaveBeenCalledWith(1, 'chosen-pw'));
  });
});

describe('connection form', () => {
  it('needs no database name, offers QA / Staging / Development, and shows MongoDB-only fields only for MongoDB', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/Database name/)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Authentication database')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Environment'));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['QA', 'Staging', 'Development']);
    await userEvent.click(screen.getByRole('option', { name: 'Staging' }));
    await userEvent.click(within(dialog).getByLabelText('Database type'));
    await userEvent.click(await screen.findByRole('option', { name: 'MongoDB' }));
    expect(within(dialog).getByLabelText('Authentication database')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Port')).toHaveValue(27017);
    await userEvent.click(within(dialog).getByRole('button', { name: /Connection string/ }));
    expect(within(dialog).getByLabelText(/MongoDB connection string/)).toHaveValue('');
  });

  it('creates a connection with no database name and Staging as the environment', async () => {
    m.createConnection.mockResolvedValue(ALL[0]);
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Connection name/), 'Wallet');
    await userEvent.click(within(dialog).getByLabelText('Environment'));
    await userEvent.click(await screen.findByRole('option', { name: 'Staging' }));
    await userEvent.type(within(dialog).getByLabelText(/^Host/), 'db.staging.internal');
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'darshan');
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'db-secret');
    await userEvent.type(within(dialog).getByLabelText(/^Access password/), 'open-sesame');
    await userEvent.type(within(dialog).getByLabelText(/^Repeat access password/), 'open-sesame');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(m.createConnection).toHaveBeenCalled());
    const sent = m.createConnection.mock.calls[0][0];
    expect(sent.environment).toBe('STAGING');
    expect(sent.databaseName).toBe('');
    expect(sent.dbType).toBe('MYSQL');
  });

  it('refuses to create a connection when the two access passwords differ', async () => {
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Access password/), 'one-password');
    await userEvent.type(within(dialog).getByLabelText(/^Repeat access password/), 'another-one');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The two access passwords do not match')).toBeInTheDocument();
    expect(m.createConnection).not.toHaveBeenCalled();
  });
});

describe('DatabaseSelect', () => {
  const renderSelect = (props: Partial<React.ComponentProps<typeof DatabaseSelect>> = {}) =>
    render(<NotifierProvider><DatabaseSelect dbType="MYSQL" profileId={1} selected={null} {...props} /></NotifierProvider>);

  it('lists the databases the user can access and switches without reconnecting', async () => {
    m.useDatabase.mockResolvedValue({ connected: true, message: 'Connected', databaseName: 'bank_audit' });
    const onChanged = vi.fn();
    renderSelect({ onChanged });
    await waitFor(() => expect(m.databases).toHaveBeenCalledWith('MYSQL'));
    await userEvent.click(screen.getByLabelText('Active MySQL database'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['bank_wallet', 'bank_audit']);
    await userEvent.click(screen.getByRole('option', { name: 'bank_audit' }));
    await waitFor(() => expect(m.useDatabase).toHaveBeenCalledWith('bank_audit', 'MYSQL'));
    expect(m.connect).not.toHaveBeenCalled();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(await toastOf(/Now using database bank_audit/)).toBeInTheDocument();
  });

  it('works for MongoDB connections too', async () => {
    m.databases.mockResolvedValue({ databases: ['qa_customers'], selected: 'qa_customers', restricted: false });
    renderSelect({ dbType: 'MONGODB', selected: 'qa_customers' });
    await waitFor(() => expect(m.databases).toHaveBeenCalledWith('MONGODB'));
    expect(screen.getByLabelText('Active MongoDB database')).toBeInTheDocument();
  });

  it('lets the user type a database name when the server will not list databases for them', async () => {
    m.databases.mockResolvedValue({ databases: [], selected: null, restricted: true, message: 'The server did not allow listing databases for this user. Type the database name to use.' });
    m.useDatabase.mockResolvedValue({ connected: true, message: 'Connected' });
    renderSelect({ dbType: 'MONGODB' });
    const input = await screen.findByPlaceholderText('Type a database name');
    await userEvent.type(input, 'my_db');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(m.useDatabase).toHaveBeenCalledWith('my_db', 'MONGODB'));
  });

  it('shows a helpful placeholder and a clear error when switching is refused', async () => {
    m.useDatabase.mockRejectedValue(new Error("Database 'x' is not accessible to this database user"));
    renderSelect();
    await waitFor(() => expect(m.databases).toHaveBeenCalled());
    expect(screen.getByText('Select database…')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Active MySQL database'));
    await userEvent.click(screen.getByRole('option', { name: 'bank_wallet' }));
    expect(await toastOf(/not accessible/)).toBeInTheDocument();
  });
});
