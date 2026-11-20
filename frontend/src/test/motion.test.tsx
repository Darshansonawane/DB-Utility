import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QuerySuccessBanner } from '../components/motion/DbSuccess';
import FlowConnector, { flowStateOf } from '../components/motion/FlowConnector';
import StepStage from '../components/motion/StepStage';
import StepCard, { stepToneOf } from '../components/motion/StepCard';

describe('database motion', () => {
  it('shows rows returned for a read and rows affected for a write', async () => {
    const { rerender } = render(<QuerySuccessBanner rowCount={1284} durationMs={42} runKey={1} />);
    expect(screen.getByRole('status').textContent).toMatch(/Query completed/);
    expect(screen.getByTestId('db-success-icon')).toBeTruthy();
    rerender(<QuerySuccessBanner rowCount={0} affectedRows={3} durationMs={1500} runKey={2} />);
    expect(screen.getByRole('status').textContent).toMatch(/Changes applied/);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3\s*rows affected in 1.50 s/));
  });
  it('maps step statuses to connector states', () => {
    expect(flowStateOf('RUNNING')).toBe('running');
    expect(flowStateOf('SUCCESS')).toBe('done');
    expect(flowStateOf('NO_DATA')).toBe('done');
    expect(flowStateOf('FAILED')).toBe('failed');
    expect(flowStateOf('PENDING')).toBe('idle');
    expect(flowStateOf(undefined)).toBe('idle');
  });
  it('renders travelling dots only while running or done', () => {
    const { container, rerender } = render(<FlowConnector state="running" />);
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(2);
    rerender(<FlowConnector state="failed" />);
    expect(container.querySelectorAll('.flow-dot')).toHaveLength(0);
  });
});

describe('step card', () => {
  it('maps statuses to tones and renders the matching frame', () => {
    expect(stepToneOf('RUNNING')).toBe('running');
    expect(stepToneOf('SUCCESS')).toBe('success');
    expect(stepToneOf('FAILED')).toBe('failed');
    expect(stepToneOf('NO_DATA')).toBe('warn');
    expect(stepToneOf('PENDING')).toBe('idle');
    render(<StepCard status="RUNNING"><span>x</span></StepCard>);
    expect(screen.getByTestId('step-card-running').className).toContain('step-running');
  });
});

describe('step stage', () => {
  it('shows nothing for a step that is already finished when opened', () => {
    render(<StepStage order={1} name="a" status="SUCCESS" rows={2} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('shows the running stage, then celebrates when the step finishes, and reports a failure', () => {
    const { rerender } = render(<StepStage order={2} name="getUser" status="PENDING" />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<StepStage order={2} name="getUser" status="RUNNING" />);
    expect(screen.getByRole('status').textContent).toMatch(/Executing step 2/);
    rerender(<StepStage order={2} name="getUser" status="SUCCESS" rows={5} durationMs={4580} />);
    expect(screen.getByRole('status').textContent).toMatch(/Step 2 complete/);
    rerender(<StepStage order={3} name="x" status="RUNNING" />);
    rerender(<StepStage order={3} name="x" status="FAILED" error="boom" />);
    expect(screen.getByRole('status').textContent).toMatch(/Step 3 failed/);
  });
});
