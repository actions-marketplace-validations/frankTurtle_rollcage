import type { LlmClient } from '@adl/shared';
import { analyze, weekRanges } from './analysis.ts';
import type { Analysis, DeltaRow } from './analysis.ts';
import { explain, usd } from './summary.ts';
import type { SummaryResult } from './summary.ts';
import type { AnalysisConfig, CostPort, NotifyPort } from './types.ts';

export interface Delivery {
  channel: string;
  ok: boolean;
  error?: string;
}

export interface ReportDeps {
  now: Date;
  config: AnalysisConfig;
  tagKey?: string;
  cost: CostPort;
  llm?: LlmClient;
  channels: NotifyPort[];
}

export interface Report {
  analysis: Analysis;
  summary: SummaryResult;
  message: { subject: string; text: string };
  deliveries: Delivery[];
}

const signed = (n: number): string => `${n < 0 ? '-' : '+'}${usd(Math.abs(n))}`;

function rowLine(r: DeltaRow): string {
  const pct = r.pct === null ? 'new' : `${r.pct >= 0 ? '+' : ''}${r.pct}%`;
  const notes = [r.unexplained ? 'unexplained' : '', r.anomalyIds.length ? 'anomaly' : '']
    .filter(Boolean)
    .join(', ');
  return `  ${r.key}: ${usd(r.previous)} -> ${usd(r.current)} (${signed(r.delta)}, ${pct})${notes ? `  [${notes}]` : ''}`;
}

/** The numbers sit next to the prose, so the message can be checked without trusting the summary. */
export function formatMessage(
  a: Analysis,
  result: SummaryResult,
): { subject: string; text: string } {
  const { totals, unexplained } = a;
  const pct = totals.pct === null ? '' : `, ${totals.pct >= 0 ? '+' : ''}${totals.pct}%`;
  const subject = `AWS cost report, week of ${a.ranges.current.start}: ${signed(totals.delta)}${pct}`;
  const material = (rows: DeltaRow[]): string[] => {
    const lines = rows.filter((r) => r.material).map(rowLine);
    return lines.length ? lines : ['  nothing above the thresholds'];
  };
  const lines = [
    result.summary.headline,
    '',
    ...result.summary.paragraphs,
    '',
    'Assumptions:',
    ...result.summary.assumptions.map((s) => `- ${s}`),
    '',
    `Numbers, computed by code (USD, week of ${a.ranges.current.start} against the week before):`,
    `Total: ${usd(totals.previous)} -> ${usd(totals.current)} (${signed(totals.delta)}${pct})`,
    `Unexplained spend: ${usd(unexplained.amount)} (${unexplained.share}% of this week's total)`,
    '',
    `By service, changes above ${usd(a.config.minDeltaUsd)} and ${a.config.minDeltaPct}%:`,
    ...material(a.services),
    '',
    `By tag "${a.tagKey}":`,
    ...material(a.tags),
  ];
  if (a.anomalies.length) {
    lines.push('', 'Time to notice anomalies:');
    for (const x of a.anomalies) {
      lines.push(
        `  ${x.service}: started ${x.startDate}, in this report after ${x.daysToNotice} days (${x.daysToMonthEnd} days to month end), impact ${usd(x.totalImpact)}`,
      );
    }
  }
  lines.push(
    '',
    result.source === 'model'
      ? 'Summary written by the model from the figures above.'
      : `Deterministic summary (model output not used: ${result.reason ?? 'unknown'}).`,
    'Cost Explorer figures for recent days can still change.',
  );
  return { subject, text: lines.join('\n') };
}

export async function runReport(deps: ReportDeps): Promise<Report> {
  const ranges = weekRanges(deps.now);
  const tagKey = deps.tagKey ?? 'team';
  const { cost } = deps;
  const tag = { type: 'TAG', key: tagKey } as const;
  const service = { type: 'SERVICE' } as const;
  const [servicesPrev, servicesCur, tagsPrev, tagsCur, anomalies] = await Promise.all([
    cost.costByGroup(ranges.previous, service),
    cost.costByGroup(ranges.current, service),
    cost.costByGroup(ranges.previous, tag),
    cost.costByGroup(ranges.current, tag),
    cost.anomalies(ranges.current),
  ]);
  const analysis = analyze({
    ranges,
    tagKey,
    services: { previous: servicesPrev, current: servicesCur },
    tags: { previous: tagsPrev, current: tagsCur },
    anomalies,
    reportDate: deps.now.toISOString().slice(0, 10),
    config: deps.config,
  });
  const summary = await explain(deps.llm, analysis);
  const message = formatMessage(analysis, summary);

  const settled = await Promise.allSettled(
    deps.channels.map((c) => c.send(message.subject, message.text)),
  );
  const deliveries = settled.map((s, i): Delivery => {
    const channel = deps.channels[i]?.name ?? 'unknown';
    return s.status === 'fulfilled'
      ? { channel, ok: true }
      : { channel, ok: false, error: s.reason instanceof Error ? s.reason.message : 'send failed' };
  });
  if (deliveries.length > 0 && deliveries.every((d) => !d.ok)) {
    throw new Error(`all notifications failed: ${deliveries.map((d) => d.error).join('; ')}`);
  }
  return { analysis, summary, message, deliveries };
}
