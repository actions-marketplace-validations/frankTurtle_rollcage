import { daysBetween } from '@adl/shared';
import type { HistoryEntry } from './history.js';
import type { PrioritizedFinding } from './prioritize.js';
import type { IsoDay } from './types.js';

export interface MetricsOptions {
  asOf: IsoDay;
  /** Assumption: analyst minutes to read and decide one finding by hand. */
  minutesPerFinding: number;
}

export interface Metrics {
  openCriticals: number;
  waivedCriticals: number;
  openCriticalAgeDays: { id: string; package: string; days: number }[];
  mttr: { resolved: number; overallDays: number | null; criticalDays: number | null };
  triage: {
    minutesPerFinding: number;
    total: number;
    needReview: number;
    baselineMinutes: number;
    estimatedMinutes: number;
    savedMinutes: number;
  };
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

export function computeMetrics(
  items: PrioritizedFinding[],
  waived: PrioritizedFinding[],
  history: HistoryEntry[],
  opts: MetricsOptions,
): Metrics {
  const criticals = items.filter((i) => i.severity === 'Critical');
  const resolved = history.flatMap((h) =>
    h.resolvedAt ? [{ severity: h.severity, days: daysBetween(h.firstSeen, h.resolvedAt) }] : [],
  );
  const firstSeen = (id: string, pkg: string): IsoDay | undefined =>
    history.find((h) => h.id === id && h.package === pkg && !h.resolvedAt)?.firstSeen;
  const needReview = items.filter((i) => i.needsReview).length;
  const baselineMinutes = items.length * opts.minutesPerFinding;
  const estimatedMinutes = needReview * opts.minutesPerFinding;
  return {
    openCriticals: criticals.length,
    waivedCriticals: waived.filter((w) => w.severity === 'Critical').length,
    openCriticalAgeDays: criticals.flatMap((c) => {
      const seen = firstSeen(c.id, c.package);
      return seen ? [{ id: c.id, package: c.package, days: daysBetween(seen, opts.asOf) }] : [];
    }),
    mttr: {
      resolved: resolved.length,
      overallDays: mean(resolved.map((r) => r.days)),
      criticalDays: mean(resolved.filter((r) => r.severity === 'Critical').map((r) => r.days)),
    },
    triage: {
      minutesPerFinding: opts.minutesPerFinding,
      total: items.length,
      needReview,
      baselineMinutes,
      estimatedMinutes,
      savedMinutes: baselineMinutes - estimatedMinutes,
    },
  };
}

export function renderMetrics(m: Metrics): string {
  const days = (d: number | null): string => (d === null ? 'no data' : `${d.toFixed(1)} days`);
  const lines = [
    `Open criticals: ${m.openCriticals}${m.waivedCriticals > 0 ? ` (${m.waivedCriticals} more waived)` : ''}`,
    `Mean time to remediate: ${days(m.mttr.overallDays)} over ${m.mttr.resolved} resolved findings (Critical only: ${days(m.mttr.criticalDays)})`,
    `Analyst triage time (estimate): ${m.triage.estimatedMinutes} min for ${m.triage.needReview} of ${m.triage.total} findings, against ${m.triage.baselineMinutes} min to read all of them`,
    `  based on ${m.triage.minutesPerFinding} min per finding (assumption). Replace it with a measured figure.`,
  ];
  return lines.join('\n');
}
