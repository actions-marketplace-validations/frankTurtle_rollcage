import { completeStructured } from '@adl/shared';
import type { LlmClient } from '@adl/shared';
import { z } from 'zod';
import { round2 } from './analysis.ts';
import type { Analysis, DeltaRow } from './analysis.ts';

export interface Summary {
  headline: string;
  paragraphs: string[];
  assumptions: string[];
}

export interface SummaryResult {
  summary: Summary;
  /** 'model' only when the model's JSON validated and every dollar figure in it is in the facts. */
  source: 'model' | 'fallback';
  reason?: string;
}

export function usd(n: number): string {
  const digits = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })}`;
}

/** Every dollar amount in the analysis, as a positive number, plus its whole-dollar rounding. */
export function allowedAmounts(a: Analysis): Set<number> {
  const amounts = [
    a.totals.previous,
    a.totals.current,
    a.totals.delta,
    a.unexplained.amount,
    ...[...a.services, ...a.tags].flatMap((r) => [r.previous, r.current, r.delta]),
    ...a.anomalies.map((x) => x.totalImpact),
  ].map(Math.abs);
  return new Set(amounts.flatMap((n) => [round2(n), Math.round(n)]));
}

/** True when every `$` figure in the text is one the code computed. */
export function amountsAreGrounded(text: string, allowed: Set<number>): boolean {
  return [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].every((m) =>
    allowed.has(round2(Number((m[1] ?? '').replaceAll(',', '')))),
  );
}

function summarySchema(allowed: Set<number>) {
  return z
    .object({
      headline: z.string().min(1).max(200),
      paragraphs: z.array(z.string().min(1)).min(1).max(6),
      assumptions: z.array(z.string().min(1)).min(1).max(5),
    })
    .superRefine((s, ctx) => {
      if (
        !amountsAreGrounded([s.headline, ...s.paragraphs, ...s.assumptions].join('\n'), allowed)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'dollar figure not found in the computed facts',
        });
      }
    });
}

const rowFacts = (r: DeltaRow) => ({
  name: r.key,
  previousUsd: r.previous,
  currentUsd: r.current,
  changeUsd: r.delta,
  changePct: r.pct,
  newThisWeek: r.isNew,
  unexplained: r.unexplained,
  anomalyIds: r.anomalyIds,
});

/** The only data the model sees: aggregates the code already computed. */
export function buildFacts(a: Analysis) {
  return {
    currency: 'USD',
    currentWeek: a.ranges.current,
    previousWeek: a.ranges.previous,
    totals: a.totals,
    unexplainedUsd: a.unexplained.amount,
    unexplainedSharePct: a.unexplained.share,
    thresholds: { minChangeUsd: a.config.minDeltaUsd, minChangePct: a.config.minDeltaPct },
    expectedChanges: a.config.expectedChanges,
    materialServiceChanges: a.services.filter((r) => r.material).map(rowFacts),
    tagKey: a.tagKey,
    materialTagChanges: a.tags.filter((r) => r.material).map(rowFacts),
    anomalies: a.anomalies.map((x) => ({
      id: x.id,
      service: x.service,
      startDate: x.startDate,
      totalImpactUsd: x.totalImpact,
      rootCauses: x.rootCauses,
      daysToNotice: x.daysToNotice,
    })),
  };
}

const SYSTEM = [
  'You write the weekly AWS cost note for an engineering team, in plain English.',
  'Use only the numbers in FACTS. Do not compute new numbers and do not write any dollar figure that is not in FACTS.',
  'State a cause only when FACTS supports it (an anomaly root cause). Otherwise say it is not known.',
  'Mark every guess as an assumption and put it in "assumptions". Never state a cause as confirmed.',
  'Reply with JSON only: {"headline": string, "paragraphs": string[], "assumptions": string[]}.',
].join('\n');

export function deterministicSummary(a: Analysis): Summary {
  const { delta, pct } = a.totals;
  const direction = delta > 0 ? 'rose' : delta < 0 ? 'fell' : 'was flat';
  const size =
    delta === 0 ? '' : ` ${usd(Math.abs(delta))}${pct === null ? '' : ` (${Math.abs(pct)}%)`}`;
  const unexplained =
    a.unexplained.amount > 0
      ? `${usd(a.unexplained.amount)} of the increase is unexplained`
      : 'no unexplained increases';
  const paragraphs = a.services
    .filter((r) => r.unexplained)
    .slice(0, 3)
    .map((r) => {
      const found = a.anomalies.filter((x) => r.anomalyIds.includes(x.id));
      const flagged = found.length
        ? `; Cost Anomaly Detection flagged it (${found.flatMap((x) => x.rootCauses).join(', ') || 'no root cause given'})`
        : '';
      const move = r.isNew
        ? `is new this week at ${usd(r.current)}`
        : `rose ${usd(r.delta)} (${usd(r.previous)} to ${usd(r.current)})`;
      return `${r.key} ${move}${flagged}.`;
    });
  if (a.untagged && a.untagged.current > 0) {
    paragraphs.push(
      `Spend with no "${a.tagKey}" tag is ${usd(a.untagged.current)} (${a.untagged.delta >= 0 ? 'up' : 'down'} ${usd(Math.abs(a.untagged.delta))}).`,
    );
  }
  if (paragraphs.length === 0) {
    paragraphs.push(
      `No service changed by more than ${usd(a.config.minDeltaUsd)} and ${a.config.minDeltaPct}%.`,
    );
  }
  return {
    headline: `Spend ${direction}${size} week over week; ${unexplained}.`,
    paragraphs,
    assumptions: [
      'Cost Explorer figures for recent days can still be revised.',
      'This note was built by code from the computed figures and states no causes beyond anomaly root causes.',
    ],
  };
}

/** Ask the model to explain the numbers. Any failure sends the deterministic summary instead. */
export async function explain(llm: LlmClient | undefined, a: Analysis): Promise<SummaryResult> {
  if (!llm) {
    return { summary: deterministicSummary(a), source: 'fallback', reason: 'no model configured' };
  }
  const result = await completeStructured(
    llm,
    {
      system: SYSTEM,
      prompt: `FACTS:\n${JSON.stringify(buildFacts(a), null, 2)}`,
      maxTokens: 2000, // 800 cut a real reply off mid-string
    },
    summarySchema(allowedAmounts(a)),
    () => deterministicSummary(a),
  );
  return {
    summary: result.value,
    source: result.source,
    ...(result.reason === undefined ? {} : { reason: result.reason }),
  };
}
