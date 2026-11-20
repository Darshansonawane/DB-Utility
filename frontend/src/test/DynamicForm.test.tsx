import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DynamicForm from '../components/DynamicForm';
import type { QueryParameter } from '../types';
import { initialValues, missingRequired } from '../utils/format';

const PARAMS: QueryParameter[] = [
  { name: 'contribution_date', label: 'Contribution Date', type: 'DATE', required: true },
  { name: 'contributor_id', label: 'Contributor ID', type: 'STRING', required: true },
  { name: 'amount', label: 'Amount', type: 'DECIMAL', required: false },
  { name: 'count', label: 'Count', type: 'INTEGER', required: false },
  { name: 'when', label: 'When', type: 'DATETIME', required: false },
  { name: 'active', label: 'Active', type: 'BOOLEAN', required: false, defaultValue: 'true' },
];

function Harness({ onValues }: { onValues?: (v: Record<string, string>) => void }) {
  const [values, setValues] = useState(initialValues(PARAMS));
  return <DynamicForm parameters={PARAMS} values={values} onChange={(v) => { setValues(v); onValues?.(v); }} />;
}

describe('DynamicForm (generic form engine)', () => {
  it('generates a control of the right type for every parameter definition', () => {
    render(<Harness />);
    expect(screen.getByTestId('field-contribution_date')).toHaveAttribute('type', 'date');
    expect(screen.getByTestId('field-contributor_id')).toHaveAttribute('type', 'text');
    expect(screen.getByTestId('field-amount')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByTestId('field-count')).toHaveAttribute('inputmode', 'numeric');
    expect(screen.getByTestId('field-when')).toHaveAttribute('type', 'datetime-local');
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeChecked();
  });

  it('labels fields from the definitions and marks required ones', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/Contributor ID/)).toBeRequired();
    expect(screen.getByLabelText(/Amount/)).not.toBeRequired();
  });

  it('reports typed values through onChange', async () => {
    let last: Record<string, string> = {};
    render(<Harness onValues={(v) => (last = v)} />);
    await userEvent.type(screen.getByTestId('field-contributor_id'), 'CT-77');
    expect(last.contributor_id).toBe('CT-77');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Active' }));
    expect(last.active).toBe('false');
  });

  it('renders nothing for a query without parameters', () => {
    const { container } = render(<DynamicForm parameters={[]} values={{}} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('computes missing required fields', () => {
    expect(missingRequired(PARAMS, { contributor_id: ' ', contribution_date: '2024-01-01' })).toEqual(['Contributor ID']);
  });
});
