import { describe, expect, it } from 'vitest';
import { daysBetween } from '../src/index.js';

describe('daysBetween', () => {
  it('counts whole UTC days, across month and leap-year boundaries', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('is negative when the end is earlier', () => {
    expect(daysBetween('2026-03-10', '2026-03-07')).toBe(-3);
  });
});
