import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Folder } from '../types';
import FolderExplorer, { DRAG_TYPE } from '../components/folders/FolderExplorer';

const createFolder = vi.fn().mockResolvedValue({});
vi.mock('../services/api', () => ({
  api: { createFolder: (...a: unknown[]) => createFolder(...a), updateFolder: vi.fn().mockResolvedValue({}), deleteFolder: vi.fn().mockResolvedValue(undefined) },
  errMsg: (e: unknown) => String(e),
}));

const folders: Folder[] = [
  { id: 1, kind: 'WORKFLOW', parentId: 0, name: 'Main Business Flows' },
  { id: 2, kind: 'WORKFLOW', parentId: 0, name: 'Micro Business Flows' },
  { id: 3, kind: 'WORKFLOW', parentId: 1, name: 'Wallet' },
];

describe('FolderExplorer', () => {
  it('shows the subfolders of the current folder with counts and navigates into them', async () => {
    const onNavigate = vi.fn();
    render(<FolderExplorer kind="WORKFLOW" folders={folders} current={0} onNavigate={onNavigate} onChanged={vi.fn()} directCounts={{ 0: 1, 2: 4, 3: 2 }} itemLabel="workflows" />);
    expect(screen.getByRole('button', { name: 'open folder Main Business Flows' })).toHaveTextContent('2 workflows · 1 folder');
    expect(screen.getByRole('button', { name: 'open folder Micro Business Flows' })).toHaveTextContent('4 workflows');
    await userEvent.click(screen.getByRole('button', { name: 'open folder Main Business Flows' }));
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('shows a breadcrumb trail and lets you jump back up', async () => {
    const onNavigate = vi.fn();
    render(<FolderExplorer kind="WORKFLOW" folders={folders} current={3} onNavigate={onNavigate} onChanged={vi.fn()} directCounts={{}} itemLabel="workflows" />);
    const trail = screen.getByLabelText('folder path');
    expect(trail).toHaveTextContent('All workflows');
    expect(trail).toHaveTextContent('Main Business Flows');
    await userEvent.click(screen.getByRole('button', { name: 'Main Business Flows' }));
    expect(onNavigate).toHaveBeenCalledWith(1);
    await userEvent.click(screen.getByRole('button', { name: /All workflows/ }));
    expect(onNavigate).toHaveBeenCalledWith(0);
  });

  it('moves a dragged item when it is dropped on a folder card or a breadcrumb', () => {
    const onDrop = vi.fn();
    render(<FolderExplorer kind="WORKFLOW" folders={folders} current={0} onNavigate={vi.fn()} onChanged={vi.fn()} directCounts={{}} itemLabel="workflows" onDropItem={onDrop} />);
    const data = { types: [DRAG_TYPE], getData: () => '42' };
    fireEvent.dragOver(screen.getByRole('button', { name: 'open folder Micro Business Flows' }), { dataTransfer: data });
    fireEvent.drop(screen.getByRole('button', { name: 'open folder Micro Business Flows' }), { dataTransfer: data });
    expect(onDrop).toHaveBeenCalledWith(42, 2);
    fireEvent.drop(screen.getByRole('button', { name: /All workflows/ }), { dataTransfer: data });
    expect(onDrop).toHaveBeenCalledWith(42, 0);
  });

  it('offers the Main / Micro business flow folders when there are none, and creates a folder in the current one', async () => {
    const onChanged = vi.fn();
    const { rerender } = render(<FolderExplorer kind="WORKFLOW" folders={[]} current={0} onNavigate={vi.fn()} onChanged={onChanged} directCounts={{}} itemLabel="workflows" suggested={['Main Business Flows', 'Micro Business Flows']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create them' }));
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('WORKFLOW', 0, 'Micro Business Flows'));
    expect(createFolder).toHaveBeenCalledWith('WORKFLOW', 0, 'Main Business Flows');
    rerender(<FolderExplorer kind="WORKFLOW" folders={folders} current={1} onNavigate={vi.fn()} onChanged={onChanged} directCounts={{}} itemLabel="workflows" />);
    await userEvent.click(screen.getByRole('button', { name: /New folder here/ }));
    await userEvent.type(screen.getByLabelText('Folder name'), 'Payments{enter}');
    await waitFor(() => expect(createFolder).toHaveBeenCalledWith('WORKFLOW', 1, 'Payments'));
  });
});
