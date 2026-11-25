import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Stage } from './types.js';

const ledgerSchema = z.object({
  /** True for fixture data that is not a real measurement. Printed on every report. */
  illustrative: z.boolean().default(false),
  entries: z
    .array(
      z.object({
        ruleId: z.string().min(1),
        stage: z.enum(['pre-merge', 'post-deploy']),
        source: z.string().optional(),
      }),
    )
    .default([]),
});

export type Ledger = z.infer<typeof ledgerSchema>;
export type LedgerEntry = Ledger['entries'][number];

export function readLedger(path: string): Ledger {
  if (!existsSync(path)) return { illustrative: false, entries: [] };
  return ledgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function recordEntries(path: string, entries: LedgerEntry[]): void {
  const ledger = readLedger(path);
  const next: Ledger = { ...ledger, entries: [...ledger.entries, ...entries] };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
}

export interface Metric {
  illustrative: boolean;
  preMerge: number;
  postDeploy: number;
  total: number;
  /** Null when nothing was recorded. */
  preMergeShare: number | null;
  byRule: Record<string, Record<'preMerge' | 'postDeploy', number>>;
}

const KEY: Record<Stage, 'preMerge' | 'postDeploy'> = {
  'pre-merge': 'preMerge',
  'post-deploy': 'postDeploy',
};

export function computeMetric(ledger: Ledger): Metric {
  const byRule: Metric['byRule'] = {};
  const totals = { preMerge: 0, postDeploy: 0 };
  for (const { ruleId, stage } of ledger.entries) {
    const key = KEY[stage];
    totals[key] += 1;
    (byRule[ruleId] ??= { preMerge: 0, postDeploy: 0 })[key] += 1;
  }
  const total = totals.preMerge + totals.postDeploy;
  return {
    illustrative: ledger.illustrative,
    ...totals,
    total,
    preMergeShare: total === 0 ? null : totals.preMerge / total,
    byRule,
  };
}

export function formatMetric(m: Metric, label = 'Policy gates'): string {
  const lines = [`${label}: caught before merge vs found after deploy`];
  if (m.illustrative) lines.push('ILLUSTRATIVE fixture data, not a measurement.');
  if (m.preMergeShare === null) return [...lines, 'No findings recorded.'].join('\n');
  lines.push(
    `Caught before merge: ${m.preMerge}`,
    `Found after deploy: ${m.postDeploy}`,
    `Pre-merge share: ${(m.preMergeShare * 100).toFixed(1)}% (${m.preMerge} of ${m.total})`,
    '',
    'By rule (before merge / after deploy)',
  );
  for (const [rule, c] of Object.entries(m.byRule).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${rule}  ${c.preMerge} / ${c.postDeploy}`);
  }
  return lines.join('\n');
}
