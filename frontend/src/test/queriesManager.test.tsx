import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { filterQueries, NO_FILTERS } from '../utils/queryFilters';
import StepTargetPicker, { searchTargets, type TargetItem } from '../components/workflow/StepTargetPicker';
import ParamDefinitionEditor, { paramMode } from '../components/ParamDefinitionEditor';
import type { SavedQuery, QueryParameter } from '../types';

const q = (o: Partial<SavedQuery>): SavedQuery => ({ id: 1, name: 'q', description: '', category: 'Accounts', sql: 'SELECT 1', queryType: 'READ', environments: [], enabled: true, parameters: [], ...o } as SavedQuery);

describe('Queries Manager filters', () => {
  const all = [
    q({ id: 1, name: 'Find customer', category: 'Customers', environments: ['QA'] }),
    q({ id: 2, name: 'Close account', category: 'Accounts', queryType: 'WRITE', environments: ['UAT'] }),
    q({ id: 3, name: 'Old report', category: 'Accounts', enabled: false }),
  ];
  it('filters by category, type, environment (legacy UAT = Staging; empty = everywhere) and enabled', () => {
    expect(filterQueries(all, { ...NO_FILTERS, category: 'Accounts' }).map((x) => x.id)).toEqual([2, 3]);
    expect(filterQueries(all, { ...NO_FILTERS, type: 'WRITE' }).map((x) => x.id)).toEqual([2]);
    expect(filterQueries(all, { ...NO_FILTERS, env: 'STAGING' }).map((x) => x.id)).toEqual([2, 3]);
    expect(filterQueries(all, { ...NO_FILTERS, env: 'QA' }).map((x) => x.id)).toEqual([1, 3]);
    expect(filterQueries(all, { ...NO_FILTERS, enabled: 'DISABLED' }).map((x) => x.id)).toEqual([3]);
  });
  it('searches every word across name, category and id', () => {
    expect(filterQueries(all, { ...NO_FILTERS, search: 'close acc' }).map((x) => x.id)).toEqual([2]);
    expect(filterQueries(all, { ...NO_FILTERS, search: 'customers find' }).map((x) => x.id)).toEqual([1]);
  });
});

describe('step target search', () => {
  const items: TargetItem[] = [
    { type: 'QUERY', id: 7, name: 'Get balance', description: 'wallet', meta: 'Accounts' },
    { type: 'API_REQUEST', id: 7, name: 'Create user', meta: 'POST https://x/users' },
    { type: 'WORKFLOW', id: 9, name: 'Onboarding' },
  ];
  it('filters by type and never mixes types', () => {
    expect(searchTargets(items, 'API_REQUEST', '').map((i) => i.name)).toEqual(['Create user']);
    expect(searchTargets(items, 'ALL', '7').map((i) => i.type)).toEqual(['QUERY', 'API_REQUEST']);
    expect(searchTargets(items, 'ALL', 'post users').map((i) => i.name)).toEqual(['Create user']);
  });
  it('handles 5,000 items instantly', () => {
    const big = Array.from({ length: 5000 }, (_, i): TargetItem => ({ type: 'QUERY', id: i + 100000, name: `Query ${i}` }));
    const t = performance.now();
    expect(searchTargets(big, 'QUERY', 'query 4999')).toHaveLength(1);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it('picks an item of another type through the combobox', async () => {
    const picked: (TargetItem | null)[] = [];
    render(<StepTargetPicker stepType="QUERY" value={null} items={items} onPick={(i) => picked.push(i)} />);
    await userEvent.click(screen.getByRole('button', { name: /All/ }));
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByTestId('target-API_REQUEST-7'));
    expect(picked[0]).toMatchObject({ type: 'API_REQUEST', id: 7 });
  });
});

describe('Runtime parameter mode', () => {
  const Host = ({ initial }: { initial: QueryParameter[] }) => {
    const [p, setP] = useState(initial);
    return <><ParamDefinitionEditor parameters={p} onChange={setP} /><output data-testid="out">{JSON.stringify(p)}</output></>;
  };
  it('infers Runtime from a blank variable and clears the variable when switched to Runtime', async () => {
    const base: QueryParameter = { name: 'id', label: 'Id', type: 'STRING', required: true, defaultValue: 'abc' } as QueryParameter;
    expect(paramMode(base)).toBe('AUTOMATIC');
    expect(paramMode({ ...base, defaultValue: null })).toBe('RUNTIME');
    render(<Host initial={[base]} />);
    await userEvent.click(screen.getByLabelText('parameter 1 runtime'));
    expect(screen.getByTestId('out').textContent).toContain('"defaultValue":null');
  });
});
