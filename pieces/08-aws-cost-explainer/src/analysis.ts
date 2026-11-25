import { round1 } from '@adl/shared';
import type { AnalysisConfig, Anomaly, CostRow, DateRange } from './types.ts';
import { UNTAGGED } from './types.ts';

/**
 * Everything the report states as a number is computed here, in code. The model is only given the
 * result and asked to put it in words.
 */

export interface AnalysisInput {
  ranges: { previous: DateRange; current: DateRange };
  tagKey: string;
  services: { previous: CostRow[]; current: CostRow[] };
  tags: { previous: CostRow[]; current: CostRow[] };
  anomalies: Anomaly[];
  /** The day the report runs, YYYY-MM-DD. */
  reportDate: string;
  config: AnalysisConfig;
}

export interface DeltaRow {
  key: string;
  previous: number;
  current: number;
  delta: number;
  /** Percent change against the previous week. Null when there was no spend before. */
  pct: number | null;
  isNew: boolean;
  material: boolean;
  /** A material increase on a service nobody said to expect. Always false for tag rows. */
  unexplained: boolean;
  anomalyIds: string[];
}

export interface AnomalyFinding extends Anomaly {
  daysToNotice: number;
  daysToMonthEnd: number;
}

export interface Analysis {
  ranges: AnalysisInput['ranges'];
  reportDate: string;
  tagKey: string;
  config: AnalysisConfig;
  totals: { previous: number; current: number; delta: number; pct: number | null };
  services: DeltaRow[];
  tags: DeltaRow[];
  untagged: DeltaRow | null;
  anomalies: AnomalyFinding[];
  unexplained: { amount: number; share: number; services: string[] };
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;
const sum = (rows: CostRow[]): number => round2(rows.reduce((total, r) => total + r.amount, 0));
const pctChange = (previous: number, delta: number): number | null =>
  previous === 0 ? null : round1((delta / previous) * 100);

const DAY_MS = 86_400_000;
const utcDay = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (from: string, to: string): number =>
  Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function lastDayOfMonth(iso: string): string {
  const d = new Date(utcDay(iso));
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** The two seven-day windows that end (exclusive) on the report day. */
export function weekRanges(now: Date): { previous: DateRange; current: DateRange } {
  const end = utcDay(now.toISOString().slice(0, 10));
  return {
    current: { start: isoDay(end - 7 * DAY_MS), end: isoDay(end) },
    previous: { start: isoDay(end - 14 * DAY_MS), end: isoDay(end - 7 * DAY_MS) },
  };
}

function deltas(
  previous: CostRow[],
  current: CostRow[],
  config: AnalysisConfig,
  anomalies: Anomaly[],
  isService: boolean,
): DeltaRow[] {
  const before = new Map(previous.map((r) => [r.key, r.amount]));
  const after = new Map(current.map((r) => [r.key, r.amount]));
  const keys = [...new Set([...before.keys(), ...after.keys()])];
  return keys
    .map((key): DeltaRow => {
      const prev = round2(before.get(key) ?? 0);
      const cur = round2(after.get(key) ?? 0);
      const delta = round2(cur - prev);
      const isNew = prev === 0 && cur > 0;
      const pct = pctChange(prev, delta);
      const material =
        Math.abs(delta) >= config.minDeltaUsd &&
        (isNew || Math.abs(pct ?? 0) >= config.minDeltaPct);
      return {
        key,
        previous: prev,
        current: cur,
        delta,
        pct,
        isNew,
        material,
        unexplained: isService && material && delta > 0 && !config.expectedChanges.includes(key),
        anomalyIds: isService ? anomalies.filter((a) => a.service === key).map((a) => a.id) : [],
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
}

export function analyze(input: AnalysisInput): Analysis {
  const { config, anomalies } = input;
  const services = deltas(input.services.previous, input.services.current, config, anomalies, true);
  const tags = deltas(input.tags.previous, input.tags.current, config, anomalies, false);

  const previous = sum(input.services.previous);
  const current = sum(input.services.current);
  const delta = round2(current - previous);

  const unexplainedRows = services.filter((r) => r.unexplained);
  const unexplainedAmount = round2(unexplainedRows.reduce((total, r) => total + r.delta, 0));

  return {
    ranges: input.ranges,
    reportDate: input.reportDate,
    tagKey: input.tagKey,
    config,
    totals: { previous, current, delta, pct: pctChange(previous, delta) },
    services,
    tags,
    untagged: tags.find((r) => r.key === UNTAGGED) ?? null,
    anomalies: anomalies.map((a) => ({
      ...a,
      daysToNotice: daysBetween(a.startDate, input.reportDate),
      daysToMonthEnd: daysBetween(a.startDate, lastDayOfMonth(a.startDate)),
    })),
    unexplained: {
      amount: unexplainedAmount,
      share: current === 0 ? 0 : round1((unexplainedAmount / current) * 100),
      services: unexplainedRows.map((r) => r.key).sort((a, b) => a.localeCompare(b)),
    },
  };
}
