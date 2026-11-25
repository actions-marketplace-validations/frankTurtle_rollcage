import { median } from '@adl/shared';
import type { Analysis } from './analysis.ts';
import { usd } from './summary.ts';

export interface CostMetrics {
  unexplainedUsd: number;
  unexplainedSharePct: number;
  anomalies: { service: string; daysToNotice: number; daysToMonthEnd: number }[];
  medianDaysToNotice: number | null;
  medianDaysToMonthEnd: number | null;
}

export function computeMetrics(a: Analysis): CostMetrics {
  return {
    unexplainedUsd: a.unexplained.amount,
    unexplainedSharePct: a.unexplained.share,
    anomalies: a.anomalies.map((x) => ({
      service: x.service,
      daysToNotice: x.daysToNotice,
      daysToMonthEnd: x.daysToMonthEnd,
    })),
    medianDaysToNotice: median(a.anomalies.map((x) => x.daysToNotice)),
    medianDaysToMonthEnd: median(a.anomalies.map((x) => x.daysToMonthEnd)),
  };
}

export function formatMetrics(m: CostMetrics, label: string): string[] {
  const lines = [
    `Metrics (${label})`,
    `Unexplained spend: ${usd(m.unexplainedUsd)} (${m.unexplainedSharePct}% of the week)`,
  ];
  if (m.anomalies.length === 0) return [...lines, 'No anomalies this week.'];
  lines.push('Time to notice an anomaly, in this report vs the monthly invoice:');
  for (const x of m.anomalies) {
    lines.push(`  ${x.service}: ${x.daysToNotice} days vs ${x.daysToMonthEnd} days`);
  }
  lines.push(`  median: ${m.medianDaysToNotice} days vs ${m.medianDaysToMonthEnd} days`);
  return lines;
}
