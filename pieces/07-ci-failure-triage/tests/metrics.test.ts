import { describe, expect, it } from 'vitest';
import { compareMetrics, computeMetrics, renderComparison } from '../src/metrics.ts';
import { parseRuns, passedLater } from '../src/runs.ts';
import type { RunRecord } from '../src/runs.ts';
import { fixtureRuns, fixtureText } from './helpers.ts';

const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const BEFORE = { since: day('2026-02-02'), until: day('2026-03-02') };
const AFTER = { since: day('2026-03-02'), until: day('2026-03-30') };

describe('run records', () => {
  it('parses the fixture file and rejects bad records with a clear message', () => {
    expect(fixtureRuns().length).toBe(52);
    expect(() => parseRuns('{"nope":1}')).toThrow(/runs file is invalid/);
    expect(() => parseRuns('[{"id":"x"}]')).toThrow(/runs file is invalid/);
    expect(() => parseRuns('not json')).toThrow(/runs file is not valid JSON/);
  });

  it('finds a later pass of the same workflow and commit', () => {
    const runs = fixtureRuns();
    const flaky = runs.find((r) => r.id === 9004 && r.attempt === 1) as RunRecord;
    const regression = runs.find((r) => r.id === 9001) as RunRecord;
    expect(passedLater(flaky, runs)).toBe(true);
    expect(passedLater(regression, runs)).toBe(false);
  });
});

describe('AC-8 metrics', () => {
  it('computes time to green, flaky failure rate and reruns per week for a period', () => {
    const after = computeMetrics(fixtureRuns(), AFTER, 5);
    expect(after.failedRuns).toBe(6);
    expect(after.episodes).toBe(6);
    expect(after.timeToGreen).toEqual({ median: 2.6, p90: 6.6 });
    expect(after.flakyFailureRate).toBeCloseTo(2 / 6, 5);
    expect(after.reruns).toBe(2);
    expect(after.weeks).toBe(4);
    expect(after.rerunsPerWeek).toBe(0.5);
    expect(after.smallSample).toBe(false);
  });

  it('counts every extra attempt as a rerun and an unresolved failure as unresolved', () => {
    const before = computeMetrics(fixtureRuns(), BEFORE, 5);
    expect(before.reruns).toBe(8);
    expect(before.rerunsPerWeek).toBe(2);
    expect(before.failedRuns).toBe(13);
    expect(before.flakyFailureRate).toBeCloseTo(8 / 13, 5);
    expect(before.unresolved).toBe(0);

    const lone: RunRecord[] = [
      {
        id: 1,
        workflow: 'ci',
        branch: 'x',
        sha: 'c'.repeat(40),
        attempt: 1,
        conclusion: 'failure',
        startedAt: '2026-03-03T10:00:00Z',
        completedAt: '2026-03-03T10:10:00Z',
      },
    ];
    expect(computeMetrics(lone, AFTER, 5)).toMatchObject({
      unresolved: 1,
      timeToGreen: { median: null, p90: null },
      smallSample: true,
    });
  });

  it('returns nulls, not zeros, when there are no failures', () => {
    expect(computeMetrics([], AFTER, 5)).toMatchObject({
      failedRuns: 0,
      flakyFailureRate: null,
      timeToGreen: { median: null, p90: null },
      smallSample: true,
    });
  });

  it('compares two periods and labels each change', () => {
    const cmp = compareMetrics(fixtureRuns(), BEFORE, AFTER, 5);
    expect(cmp.verdict).toMatchObject({
      timeToGreen: 'better',
      flakyFailureRate: 'better',
      rerunsPerWeek: 'better',
    });
    const reversed = compareMetrics(fixtureRuns(), AFTER, BEFORE, 5);
    expect(reversed.verdict.rerunsPerWeek).toBe('worse');
    const same = compareMetrics(fixtureRuns(), AFTER, AFTER, 5);
    expect(same.verdict.rerunsPerWeek).toBe('same');
    const none = compareMetrics([], BEFORE, AFTER, 5);
    expect(none.verdict.timeToGreen).toBe('n/a');
  });

  it('renders a readable table with the definitions and a small sample warning', () => {
    const text = renderComparison(compareMetrics(fixtureRuns(), BEFORE, AFTER, 5), 'fixture data');
    expect(text).toContain('Time to green');
    expect(text).toContain('Flaky failure rate');
    expect(text).toContain('Reruns per week');
    expect(text).toContain('fixture data');
    expect(text).toContain('2026-02-02 to 2026-03-01');
    const small = renderComparison(compareMetrics([], BEFORE, AFTER, 5), 'x');
    expect(small).toMatch(/small sample/i);
    expect(small).toContain('n/a');
  });

  it('reads the same runs file text as the CLI does', () => {
    expect(parseRuns(fixtureText('runs.json'))).toEqual(fixtureRuns());
  });
});
