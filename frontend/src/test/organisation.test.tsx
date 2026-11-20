import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Folder } from '../types';
import { childrenOf, folderPaths, inSelection, subtreeIds, ALL, UNFILED } from '../components/folders/folderUtils';
import { flattenJson, nameFromPath } from '../components/apiauto/ResponseExtractor';
import ExtractPicker from '../components/apiauto/ExtractPicker';
import MarkdownLite from '../components/MarkdownLite';

const folders: Folder[] = [
  { id: 1, kind: 'VARIABLE', parentId: 0, name: 'Wallet' },
  { id: 2, kind: 'VARIABLE', parentId: 1, name: 'Create' },
  { id: 3, kind: 'VARIABLE', parentId: 0, name: 'Savings' },
  { id: 4, kind: 'VARIABLE', parentId: 2, name: 'Deep' },
];

describe('folder helpers', () => {
  it('builds paths, children and subtrees', () => {
    const paths = folderPaths(folders);
    expect(paths.get(4)).toBe('Wallet / Create / Deep');
    expect(childrenOf(folders, 0).map((f) => f.name)).toEqual(['Savings', 'Wallet']);
    expect([...subtreeIds(folders, 1)].sort()).toEqual([1, 2, 4]);
  });
  it('selects items by folder, all and unfiled', () => {
    expect(inSelection(ALL, 5)).toBe(true);
    expect(inSelection(UNFILED, null)).toBe(true);
    expect(inSelection(UNFILED, 3)).toBe(false);
    expect(inSelection(3, 3)).toBe(true);
    expect(inSelection(3, 1)).toBe(false);
  });
});

describe('response extraction helpers', () => {
  const body = JSON.stringify({ data: { customerId: 'HG870812', limits: [], tags: [{ n: 'a' }, { n: 'b' }], requestId: 'a35b' }, result: { responseCode: '0' } });
  it('flattens a JSON response to selectable paths', () => {
    const e = flattenJson(body);
    expect(e).toContainEqual({ key: 'data.customerId', value: 'HG870812' });
    expect(e).toContainEqual({ key: 'data.tags[1].n', value: 'b' });
    expect(e.find((x) => x.key === 'data.limits')).toBeUndefined();
    expect(flattenJson('not json')).toEqual([]);
  });
  it('derives a valid variable name from a path', () => {
    expect(nameFromPath('data.displayAccountNumber')).toBe('displayAccountNumber');
    expect(nameFromPath('items[0].first-name')).toBe('first_name');
    expect(nameFromPath('data[0]')).toBe('data');
  });
});

describe('ExtractPicker', () => {
  it('lets you tick fields, rename them, choose a folder and saves the selection', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExtractPicker title="Extract" keyLabel="Column" canRemember folders={folders}
      entries={[{ key: 'id', value: '45821' }, { key: 'display_account_no', value: '20000000776' }]} defaultName={(k) => k.replace(/_/g, '')} onSave={onSave} />);
    const save = screen.getByRole('button', { name: /save/i });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText('select id'));
    const name = screen.getByLabelText('variable name for id');
    await userEvent.clear(name);
    await userEvent.type(name, 'savingsWalletDetailsId');
    expect(screen.getByRole('button', { name: /save 1 as variables/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /save 1 as variables/i }));
    expect(onSave).toHaveBeenCalledWith([{ key: 'id', name: 'savingsWalletDetailsId', value: '45821', secret: false, folderId: 0 }], true);
    expect(await screen.findByText(/Saved 1 variable/)).toBeInTheDocument();
  });
  it('rejects invalid variable names', async () => {
    render(<ExtractPicker title="Extract" keyLabel="Column" canRemember={false} folders={[]} entries={[{ key: 'id', value: '1' }]} defaultName={() => 'bad name'} onSave={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('select id'));
    expect(screen.getByRole('button', { name: /save 1 as variables/i })).toBeDisabled();
    expect(screen.getByText(/must start with a letter/)).toBeInTheDocument();
  });
});

describe('MarkdownLite', () => {
  it('renders headings, lists, code, tables and inline styles without injecting HTML', () => {
    const { container } = render(<MarkdownLite text={'# Wallet\n\n- **one**\n- `two`\n\n| Table | Purpose |\n|---|---|\n| swd | pockets |\n\n```\nSELECT 1\n```\n\n<script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com)'} />);
    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('one').tagName).toBe('STRONG');
    expect(screen.getByText('two').tagName).toBe('CODE');
    const table = container.querySelector('table')!;
    expect(within(table).getByText('pockets')).toBeInTheDocument();
    expect(container.querySelector('pre')!.textContent).toBe('SELECT 1');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['https://example.com']);
  });
});
