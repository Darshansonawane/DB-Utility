import type { Workflow } from '../../types';

/** "Name (copy)", then "Name (copy 2)"... the first one not used by another workflow of the same project. */
export function copyName(name: string, taken: string[]): string {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  let candidate = `${name} (copy)`;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${name} (copy ${i})`;
  return candidate.slice(0, 200);
}

/** A new, unsaved copy of a workflow in the same project and folder: same inputs, steps, mappings, saves and pauses. */
export function duplicateOf(w: Workflow, taken: string[]): Workflow {
  return {
    ...w, id: undefined, name: copyName(w.name, taken),
    lastStatus: undefined, lastRunAt: undefined, updatedAt: undefined,
    steps: w.steps.map((s) => ({ ...s, id: undefined })),
  } as Workflow;
}
