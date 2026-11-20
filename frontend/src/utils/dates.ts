/** Date helpers use the browser's local calendar date (not UTC) so "today" matches the tester's day. */
export function toIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function today(now: Date = new Date()): string {
  return toIso(now);
}

/** The day before today. */
export function previousDate(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return toIso(d);
}

/** Same day last month; clamps to month end (31 Mar -> 28/29 Feb). */
export function oneMonthBack(now: Date = new Date()): string {
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return toIso(new Date(y, m, Math.min(now.getDate(), lastDay)));
}

export type DateSource = 'TODAY' | 'PREVIOUS' | 'ONE_MONTH_BACK' | 'ORIGINAL' | 'CUSTOM';

export function resolveDate(source: DateSource, opts: { original?: string | null; custom?: string; now?: Date }): string | null {
  switch (source) {
    case 'TODAY': return today(opts.now);
    case 'PREVIOUS': return previousDate(opts.now);
    case 'ONE_MONTH_BACK': return oneMonthBack(opts.now);
    case 'ORIGINAL': return opts.original ?? null;
    case 'CUSTOM': return opts.custom && /^\d{4}-\d{2}-\d{2}$/.test(opts.custom) ? opts.custom : null;
  }
}
