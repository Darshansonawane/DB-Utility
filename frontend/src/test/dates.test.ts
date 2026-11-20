import { oneMonthBack, previousDate, resolveDate, today } from '../utils/dates';

describe('date helpers', () => {
  const now = new Date(2024, 2, 31); // 31 March 2024 (local)
  it('computes today, previous day and one month back with month-end clamping', () => {
    expect(today(now)).toBe('2024-03-31');
    expect(previousDate(now)).toBe('2024-03-30');
    expect(oneMonthBack(now)).toBe('2024-02-29');
    expect(oneMonthBack(new Date(2025, 0, 15))).toBe('2024-12-15');
    expect(previousDate(new Date(2024, 0, 1))).toBe('2023-12-31');
  });

  it('resolves each source; original and custom need a value', () => {
    expect(resolveDate('ORIGINAL', { original: '2024-01-05', now })).toBe('2024-01-05');
    expect(resolveDate('ORIGINAL', { now })).toBeNull();
    expect(resolveDate('CUSTOM', { custom: '2024-13-45x', now })).toBeNull();
    expect(resolveDate('CUSTOM', { custom: '2024-06-01', now })).toBe('2024-06-01');
    expect(resolveDate('TODAY', { now })).toBe('2024-03-31');
  });
});
