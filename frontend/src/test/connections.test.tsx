import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionView } from '../types';

vi.mock('../services/api', () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  api: {
    connections: vi.fn(), statuses: vi.fn(), reachable: vi.fn(), connect: vi.fn(), testConnection: vi.fn(), setAccessPassword: vi.fn(),
    deleteConnection: vi.fn(), createConnection: vi.fn(), updateConnection: vi.fn(), testConnectionDraft: vi.fn(), disconnectOne: vi.fn(),
    activateConnection: vi.fn(), openVpn: vi.fn(),
  },
}));
import { api } from '../services/api';
import Connections from '../pages/Connections';

const conn = (o: Partial<ConnectionView>): ConnectionView => ({
  id: 1, name: 'Savings_Wallet', environment: 'QA', dbType: 'MYSQL', host: '10.0.0.1', port: 3306, databaseName: 'bank_wallet', username: 'darshan',
  tls: false, usesUri: false, ownerName: 'Darshan', passwordProtected: true, connected: false, active: false, ...o,
});
const m = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.statuses.mockResolvedValue([]);
  m.reachable.mockResolvedValue({ reachable: true });
});

describe('Connections', () => {
  it('shows the database type, environment and owner of every connection', async () => {
    m.connections.mockResolvedValue([conn({}), conn({ id: 2, name: 'Customer_Data', dbType: 'MONGODB', environment: 'DEV', port: 27017, ownerName: 'Rahul' })]);
    render(<Connections />);
    expect(await screen.findByText('Savings_Wallet')).toBeInTheDocument();
    expect(screen.getByText('MySQL')).toBeInTheDocument();
    expect(screen.getByText('MongoDB')).toBeInTheDocument();
    expect(screen.getByText('DEV')).toBeInTheDocument();
    expect(screen.getByText('Rahul')).toBeInTheDocument();
  });

  it('asks for the connection access password before connecting and sends it', async () => {
    m.connections.mockResolvedValue([conn({})]);
    m.connect.mockResolvedValue({ connected: true, message: 'Connected' });
    render(<Connections />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    expect(m.connect).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Access password'), 'open-sesame');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(m.connect).toHaveBeenCalledWith(1, 'open-sesame'));
  });

  it('shows the backend error and stays locked when the access password is wrong', async () => {
    m.connections.mockResolvedValue([conn({})]);
    m.connect.mockRejectedValue(new Error('Incorrect access password for this connection.'));
    render(<Connections />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Access password'), 'guess1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(await within(dialog).findByText('Incorrect access password for this connection.')).toBeInTheDocument();
  });

  it('lets the first person choose an access password for an older, unprotected connection', async () => {
    m.connections.mockResolvedValue([conn({ passwordProtected: false })]);
    m.setAccessPassword.mockResolvedValue(conn({}));
    m.connect.mockResolvedValue({ connected: true, message: 'Connected' });
    render(<Connections />);
    await userEvent.click(await screen.findByRole('button', { name: 'Connect' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Set an access password/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Access password'), 'chosen-pw');
    await userEvent.type(within(dialog).getByLabelText('Repeat access password'), 'chosen-pw');
    await userEvent.click(within(dialog).getByRole('button', { name: /Set password and connect/ }));
    await waitFor(() => expect(m.setAccessPassword).toHaveBeenCalledWith(1, 'chosen-pw'));
    await waitFor(() => expect(m.connect).toHaveBeenCalledWith(1, 'chosen-pw'));
  });

  it('shows MongoDB-specific fields only for MongoDB and never prefills secrets', async () => {
    m.connections.mockResolvedValue([]);
    render(<Connections />);
    await userEvent.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Authentication database')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Port')).toHaveValue(3306);
    await userEvent.click(within(dialog).getByLabelText('Database type'));
    await userEvent.click(await screen.findByRole('option', { name: 'MongoDB' }));
    expect(within(dialog).getByLabelText('Authentication database')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Port')).toHaveValue(27017);
    await userEvent.click(within(dialog).getByRole('button', { name: /Connection string/ }));
    expect(within(dialog).getByLabelText(/MongoDB connection string/)).toHaveValue('');
    expect(within(dialog).queryByLabelText('Host')).not.toBeInTheDocument();
  });

  it('refuses to create a connection when the two access passwords differ', async () => {
    m.connections.mockResolvedValue([]);
    render(<Connections />);
    await userEvent.click(await screen.findByRole('button', { name: 'New connection' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Access password/), 'one-password');
    await userEvent.type(within(dialog).getByLabelText(/^Repeat access password/), 'another-one');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('The two access passwords do not match')).toBeInTheDocument();
    expect(m.createConnection).not.toHaveBeenCalled();
  });
});
