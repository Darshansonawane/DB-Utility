import type { WorkflowStep } from '../../types';

/**
 * Moves one step to a new position and renumbers every step 1..n. References to a step number (dependencies and "earlier step output"
 * mappings) follow the steps they pointed at, so reordering never silently rewires the workflow.
 */
export function reorderSteps(steps: WorkflowStep[], from: number, to: number): { steps: WorkflowStep[]; renumber: Map<number, number> } {
  const renumber = new Map<number, number>();
  if (from === to || to < 0 || to >= steps.length || from < 0 || from >= steps.length) { steps.forEach((s) => renumber.set(s.order, s.order)); return { steps, renumber }; }
  const moved = [...steps];
  const [m] = moved.splice(from, 1);
  moved.splice(to, 0, m);
  moved.forEach((s, i) => renumber.set(s.order, i + 1));
  const ref = (r?: string | null) => String(renumber.get(parseInt(r ?? '', 10)) ?? r ?? '');
  return {
    renumber,
    steps: moved.map((s, i) => ({
      ...s, order: i + 1, dependsOn: s.dependsOn.map((d) => renumber.get(d) ?? d),
      mappings: s.mappings.map((mp) => (mp.sourceType === 'STEP_OUTPUT' ? { ...mp, sourceRef: ref(mp.sourceRef) } : mp)),
    })),
  };
}
