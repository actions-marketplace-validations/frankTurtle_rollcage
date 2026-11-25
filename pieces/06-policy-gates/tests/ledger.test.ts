import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeMetric, formatMetric, readLedger, recordEntries } from '../src/ledger.js';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'pg-ledger-')), 'ledger.json');

function entries(pre: number, post: number) {
  return [
    ...Array.from({ length: pre }, () => ({ ruleId: 'PG001', stage: 'pre-merge' as const })),
    ...Array.from({ length: post }, () => ({ ruleId: 'PG002', stage: 'post-deploy' as const })),
  ];
}

describe('computeMetric', () => {
  it('counts pre-merge and post-deploy findings and the pre-merge share', () => {
    const m = computeMetric({ illustrative: false, entries: entries(14, 3) });
    expect(m).toMatchObject({ preMerge: 14, postDeploy: 3, total: 17 });
    expect(m.preMergeShare).toBeCloseTo(14 / 17);
  });

  it('breaks counts down by rule', () => {
    const m = computeMetric({ illustrative: false, entries: entries(2, 1) });
    expect(m.byRule).toEqual({
      PG001: { preMerge: 2, postDeploy: 0 },
      PG002: { preMerge: 0, postDeploy: 1 },
    });
  });

  it('has no share when nothing was recorded', () => {
    expect(computeMetric({ illustrative: false, entries: [] }).preMergeShare).toBeNull();
  });
});

describe('formatMetric', () => {
  it('prints both counts and the share', () => {
    const text = formatMetric(computeMetric({ illustrative: false, entries: entries(14, 3) }));
    expect(text).toContain('Caught before merge: 14');
    expect(text).toContain('Found after deploy: 3');
    expect(text).toContain('Pre-merge share: 82.4% (14 of 17)');
    expect(text).toContain('PG001');
    expect(text).not.toMatch(/ILLUSTRATIVE/);
  });

  it('labels illustrative fixture data', () => {
    const text = formatMetric(
      computeMetric({ illustrative: true, entries: entries(1, 1) }),
      'Demo',
    );
    expect(text).toMatch(/ILLUSTRATIVE fixture data/);
    expect(text).toContain('Demo');
  });

  it('says so when there is nothing to report', () => {
    const text = formatMetric(computeMetric({ illustrative: false, entries: [] }));
    expect(text).toContain('No findings recorded');
  });
});

describe('ledger files', () => {
  it('reads a missing ledger as empty', () => {
    expect(readLedger(tmp())).toEqual({ illustrative: false, entries: [] });
  });

  it('appends entries and keeps earlier ones', () => {
    const path = tmp();
    recordEntries(path, [{ ruleId: 'PG001', stage: 'pre-merge', source: 'plan.json' }]);
    recordEntries(path, [{ ruleId: 'PG002', stage: 'post-deploy' }]);
    const ledger = readLedger(path);
    expect(ledger.entries.map((e) => e.ruleId)).toEqual(['PG001', 'PG002']);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(2);
  });

  it('preserves the illustrative flag when appending', () => {
    const path = tmp();
    writeFileSync(path, JSON.stringify({ illustrative: true, entries: [] }));
    recordEntries(path, [{ ruleId: 'PG003', stage: 'pre-merge' }]);
    expect(readLedger(path).illustrative).toBe(true);
  });

  it('rejects a ledger with an unknown stage', () => {
    const path = tmp();
    writeFileSync(path, JSON.stringify({ entries: [{ ruleId: 'PG001', stage: 'later' }] }));
    expect(() => readLedger(path)).toThrow();
  });
});
