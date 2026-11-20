import type { Folder } from '../../types';

export const ALL = -1;
export const UNFILED = 0;

/** "Wallet / Savings" paths keyed by folder id. */
export function folderPaths(folders: Folder[]): Map<number, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<number, string>();
  for (const f of folders) {
    const parts = [f.name];
    let p = f.parentId;
    let guard = 0;
    while (p !== 0 && byId.has(p) && guard++ < 20) { parts.unshift(byId.get(p)!.name); p = byId.get(p)!.parentId; }
    out.set(f.id, parts.join(' / '));
  }
  return out;
}

export function childrenOf(folders: Folder[], parentId: number): Folder[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The folder and everything below it. */
export function subtreeIds(folders: Folder[], id: number): Set<number> {
  const out = new Set<number>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

/** Does an item living in itemFolder belong to the current selection (a folder, ALL or UNFILED)? */
export function inSelection(selected: number, itemFolder: number | null | undefined): boolean {
  const f = itemFolder ?? 0;
  if (selected === ALL) return true;
  return f === selected;
}
