import { round1, summarize } from '@adl/shared';
import { ms, passedLater } from './runs.js';
import type { RunRecord } from './runs.js';

export interface Period {
  since: Date;
  /** Exclusive. */
  until: Date;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Metrics {
  period: Period;
  weeks: number;
  /** Failed run attempts completed in the period. */
  failedRuns: number;
  /** Stretches of red: a failure with no failure before it since the last pass on that branch. */
  episodes: number;
  /** Episodes with no later pass on the same workflow and branch. */
  unresolved: number;
  timeToGreen: { median: number | null; p90: number | null };
  /** Failed runs whose commit later passed the same workflow, over all failed runs. Null with no failures. */
  flakyFailureRate: number | null;
  reruns: number;
  rerunsPerWeek: number;
  /** Fewer failed runs than the minimum: read the numbers as anecdotes. */
  smallSample: boolean;
}

const inPeriod = (iso: string, p: Period): boolean =>
  ms(iso) >= p.since.getTime() && ms(iso) < p.until.getTime();

interface Episode {
  failure: RunRecord;
  /** Hours from the failure completing to the next pass on the same workflow and branch. */
  hours: number | null;
}

/** Walk each workflow and branch in time order and pair the first failure of a red stretch with the next pass. */
function episodes(runs: readonly RunRecord[]): Episode[] {
  const ordered = runs
    .filter((r) => r.conclusion !== 'cancelled')
    .sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  const out: Episode[] = [];
  const groups = new Map<string, RunRecord[]>();
  for (const r of ordered) {
    const key = `${r.workflow}\u0000${r.branch}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  for (const group of groups.values()) {
    let open: RunRecord | undefined;
    for (const r of group) {
      if (r.conclusion === 'failure') {
        open ??= r;
      } else if (open) {
        out.push({ failure: open, hours: (ms(r.completedAt) - ms(open.completedAt)) / HOUR });
        open = undefined;
      }
    }
    if (open) out.push({ failure: open, hours: null });
  }
  return out;
}

export function computeMetrics(
  runs: readonly RunRecord[],
  period: Period,
  minSamples: number,
): Metrics {
  const weeks = (period.until.getTime() - period.since.getTime()) / (7 * DAY);
  const failed = runs.filter((r) => r.conclusion === 'failure' && inPeriod(r.completedAt, period));
  const reruns = runs.filter((r) => r.attempt > 1 && inPeriod(r.startedAt, period)).length;
  const inRange = episodes(runs).filter((e) => inPeriod(e.failure.completedAt, period));
  const hours = inRange.flatMap((e) => (e.hours === null ? [] : [e.hours]));
  const flaky = failed.filter((r) => passedLater(r, runs)).length;
  return {
    period,
    weeks,
    failedRuns: failed.length,
    episodes: inRange.length,
    unresolved: inRange.length - hours.length,
    timeToGreen: summarize(hours),
    flakyFailureRate: failed.length ? flaky / failed.length : null,
    reruns,
    rerunsPerWeek: round1(reruns / weeks),
    smallSample: failed.length < minSamples,
  };
}

export type Verdict = 'better' | 'worse' | 'same' | 'n/a';

export interface Comparison {
  before: Metrics;
  after: Metrics;
  verdict: { timeToGreen: Verdict; flakyFailureRate: Verdict; rerunsPerWeek: Verdict };
}

/** All three metrics read lower is better. */
function lowerIsBetter(before: number | null, after: number | null): Verdict {
  if (before === null || after === null) return 'n/a';
  if (after === before) return 'same';
  return after < before ? 'better' : 'worse';
}

export function compareMetrics(
  runs: readonly RunRecord[],
  before: Period,
  after: Period,
  minSamples: number,
): Comparison {
  const b = computeMetrics(runs, before, minSamples);
  const a = computeMetrics(runs, after, minSamples);
  return {
    before: b,
    after: a,
    verdict: {
      timeToGreen: lowerIsBetter(b.timeToGreen.median, a.timeToGreen.median),
      flakyFailureRate: lowerIsBetter(b.flakyFailureRate, a.flakyFailureRate),
      rerunsPerWeek: lowerIsBetter(b.rerunsPerWeek, a.rerunsPerWeek),
    },
  };
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const lastDay = (p: Period): string => isoDay(new Date(p.until.getTime() - DAY));
const rate = (r: number | null): string => (r === null ? 'n/a' : `${round1(r * 100)}%`);
const hoursText = (t: Metrics['timeToGreen']): string =>
  t.median === null ? 'n/a' : `median ${t.median} h, p90 ${t.p90} h`;

export function renderPeriod(m: Metrics, title: string): string {
  return [
    `${title}: ${isoDay(m.period.since)} to ${lastDay(m.period)}`,
    `  Failed runs          ${m.failedRuns}`,
    `  Time to green        ${hoursText(m.timeToGreen)}`,
    `  Flaky failure rate   ${rate(m.flakyFailureRate)}`,
    `  Reruns per week      ${m.rerunsPerWeek}`,
    ...(m.unresolved ? [`  Not yet green        ${m.unresolved}`] : []),
    ...(m.smallSample
      ? ['  Small sample: fewer failed runs than the minimum, read with care.']
      : []),
  ].join('\n');
}

export function renderComparison(c: Comparison, label: string): string {
  const v = c.verdict;
  return [
    `Data: ${label}`,
    '',
    renderPeriod(c.before, 'Before'),
    '',
    renderPeriod(c.after, 'After'),
    '',
    'Change (lower is better for all three)',
    `  Time to green        ${v.timeToGreen}`,
    `  Flaky failure rate   ${v.flakyFailureRate}`,
    `  Reruns per week      ${v.rerunsPerWeek}`,
    '',
    'Time to green: hours from a failed run to the next pass of the same workflow and branch.',
    'Flaky failure rate: failed runs whose commit later passed the same workflow.',
    'Reruns per week: run attempts beyond the first.',
  ].join('\n');
}
