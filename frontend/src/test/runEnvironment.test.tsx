import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const set = vi.fn(async (e: string) => ({ environment: e }));
vi.mock('../services/api', () => ({ api: { activeEnvironment: async () => ({ environment: 'DEV' }), setActiveEnvironment: (e: string) => set(e) } }));

import RunEnvironment from '../components/RunEnvironment';

describe('run environment picker', () => {
  beforeEach(() => { set.mockClear(); });
  it('shows Dev, QA and Staging in that order, marks the saved one, and switches every picker together', async () => {
    render(<><RunEnvironment /><RunEnvironment label="Environment" /></>);
    const firstGroup = screen.getAllByRole('group', { name: 'run environment' })[0];
    expect(Array.from(firstGroup.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Dev', 'QA', 'Staging']);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'environment Dev' })[0]).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.click(screen.getAllByRole('button', { name: 'environment Staging' })[0]);
    expect(set).toHaveBeenCalledWith('STAGING');
    await waitFor(() => screen.getAllByRole('button', { name: 'environment Staging' }).forEach((b) => expect(b).toHaveAttribute('aria-pressed', 'true')));
  });
});
