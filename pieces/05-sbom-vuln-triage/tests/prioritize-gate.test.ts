import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateGate } from '../src/gate.ts';
import { meetsSeverity, prioritize } from '../src/prioritize.ts';
import { parseWaivers } from '../src/waivers.ts';
import { feeds, finding } from './helpers.ts';

const OPTS = { epssThreshold: 0.1, asOf: '2026-11-25' };
const tierOf = (
  f: ReturnType<typeof finding>,
  kev: string[] = [],
  epss: number | undefined = undefined,
) => prioritize([f], feeds(kev, epss === undefined ? {} : { [f.id]: epss }), OPTS).items[0];

describe('AC2: tier rules', () => {
  it('puts a KEV member in P0 whatever its severity', () => {
    expect(tierOf(finding({ id: 'CVE-1', severity: 'Low' }), ['CVE-1'])?.tier).toBe('P0');
  });

  it('puts a Critical with high EPSS in P0, and a Critical with low EPSS in P1', () => {
    expect(tierOf(finding({ id: 'CVE-2', severity: 'Critical' }), [], 0.5)?.tier).toBe('P0');
    expect(tierOf(finding({ id: 'CVE-3', severity: 'Critical' }), [], 0.01)?.tier).toBe('P1');
  });

  it('puts a High with high EPSS in P1 and any other High in P2', () => {
    expect(tierOf(finding({ id: 'CVE-4', severity: 'High' }), [], 0.2)?.tier).toBe('P1');
    expect(tierOf(finding({ id: 'CVE-5', severity: 'High' }), [], 0.01)?.tier).toBe('P2');
  });

  it('puts a Medium with high EPSS in P2 and the rest in P3', () => {
    expect(tierOf(finding({ id: 'CVE-6', severity: 'Medium' }), [], 0.3)?.tier).toBe('P2');
    expect(tierOf(finding({ id: 'CVE-7', severity: 'Medium' }), [], 0.01)?.tier).toBe('P3');
    expect(tierOf(finding({ id: 'CVE-8', severity: 'Low' }), [], 0.05)?.tier).toBe('P3');
  });

  it('treats the EPSS threshold as strictly greater than', () => {
    expect(tierOf(finding({ id: 'CVE-9', severity: 'Critical' }), [], 0.1)?.tier).toBe('P1');
  });

  it('flags a missing EPSS entry and treats it as 0', () => {
    const item = tierOf(finding({ id: 'CVE-10', severity: 'High' }));
    expect(item?.epss).toBeNull();
    expect(item?.tier).toBe('P2');
    expect(item?.reasons.join(' ')).toMatch(/EPSS missing/);
  });
});

describe('AC3: ordering inside the result', () => {
  it('sorts by tier, then EPSS, then severity, then fix, then id', () => {
    const items = prioritize(
      [
        finding({ id: 'CVE-B', severity: 'High' }),
        finding({ id: 'CVE-A', severity: 'High' }),
        finding({ id: 'CVE-C', severity: 'Critical' }),
        finding({ id: 'CVE-D', severity: 'High', fixVersions: [], fixState: 'not-fixed' }),
        finding({ id: 'CVE-E', severity: 'Medium' }),
      ],
      feeds([], { 'CVE-A': 0.05, 'CVE-B': 0.05, 'CVE-C': 0.02, 'CVE-D': 0.05, 'CVE-E': 0.2 }),
      OPTS,
    ).items;
    expect(items.map((i) => i.id)).toEqual(['CVE-C', 'CVE-E', 'CVE-A', 'CVE-B', 'CVE-D']);
  });
});

describe('AC4: GHSA findings use their related CVE', () => {
  it('looks KEV and EPSS up by the CVE, not the GHSA id', () => {
    const f = finding({ id: 'GHSA-aaaa-bbbb-cccc', cve: 'CVE-2022-1', severity: 'High' });
    const item = prioritize([f], feeds(['CVE-2022-1'], { 'CVE-2022-1': 0.4 }), OPTS).items[0];
    expect(item?.inKev).toBe(true);
    expect(item?.epss).toBe(0.4);
    expect(item?.tier).toBe('P0');
  });

  it('has no lookup for a GHSA with no CVE', () => {
    const f = finding({ id: 'GHSA-aaaa-bbbb-cccc', cve: null });
    const item = prioritize([f], feeds(['GHSA-aaaa-bbbb-cccc']), OPTS).items[0];
    expect(item?.inKev).toBe(false);
  });
});

describe('AC5: no fix', () => {
  it('keeps the tier, changes the action and asks for review when in P2', () => {
    const noFix = finding({
      id: 'CVE-11',
      severity: 'High',
      fixVersions: [],
      fixState: 'wont-fix',
    });
    const item = tierOf(noFix, [], 0.01);
    expect(item?.tier).toBe('P2');
    expect(item?.hasFix).toBe(false);
    expect(item?.action).toMatch(/no fix released/i);
    expect(item?.needsReview).toBe(true);
  });

  it('names the fixed version in the action and skips review for a routine P2 bump', () => {
    const item = tierOf(
      finding({ id: 'CVE-12', severity: 'High', fixVersions: ['2.0.0'] }),
      [],
      0.01,
    );
    expect(item?.action).toContain('2.0.0');
    expect(item?.needsReview).toBe(false);
  });

  it('asks for review on P0 and P1', () => {
    expect(tierOf(finding({ id: 'CVE-13', severity: 'Critical' }), [], 0.01)?.needsReview).toBe(
      true,
    );
  });
});

describe('severity helper', () => {
  it('orders severities and treats the threshold as inclusive', () => {
    expect(meetsSeverity('Critical', 'high')).toBe(true);
    expect(meetsSeverity('High', 'high')).toBe(true);
    expect(meetsSeverity('Medium', 'high')).toBe(false);
    expect(meetsSeverity('Unknown', 'low')).toBe(false);
  });
});

describe('AC13: the gate', () => {
  const f = [
    finding({ id: 'CVE-K', severity: 'Critical' }),
    finding({ id: 'CVE-E', severity: 'Critical' }),
    finding({ id: 'CVE-Q', severity: 'Critical' }),
    finding({ id: 'CVE-H', severity: 'High' }),
  ];
  const items = prioritize(
    f,
    feeds(['CVE-K', 'CVE-H'], { 'CVE-E': 0.5, 'CVE-Q': 0.01 }),
    OPTS,
  ).items;

  it('fails on a critical that is in KEV or above the EPSS threshold, and lists why', () => {
    const result = evaluateGate(items, { failOn: 'critical', epssThreshold: 0.1 });
    expect(result.pass).toBe(false);
    expect(result.blocking.map((b) => b.id).sort()).toEqual(['CVE-E', 'CVE-K']);
    expect(result.blocking.find((b) => b.id === 'CVE-K')?.why).toBe('in KEV');
    expect(result.blocking.find((b) => b.id === 'CVE-E')?.why).toMatch(/EPSS 0\.50/);
  });

  it('does not block on severity alone', () => {
    const only = prioritize(
      [finding({ id: 'CVE-Q', severity: 'Critical' })],
      feeds([], { 'CVE-Q': 0.01 }),
      OPTS,
    );
    expect(evaluateGate(only.items, { failOn: 'critical', epssThreshold: 0.1 }).pass).toBe(true);
  });

  it('lowering fail-on to high adds the High finding in KEV', () => {
    const result = evaluateGate(items, { failOn: 'high', epssThreshold: 0.1 });
    expect(result.blocking.map((b) => b.id)).toContain('CVE-H');
  });

  it('passes an empty scan', () => {
    expect(evaluateGate([], { failOn: 'low', epssThreshold: 0.1 }).pass).toBe(true);
  });
});

describe('AC14: waivers', () => {
  const waivers = parseWaivers({
    waivers: [
      { id: 'CVE-W', package: 'pkg', reason: 'accepted', owner: 'team', expires: '2027-01-01' },
      { id: 'CVE-X', package: 'pkg', reason: 'old', owner: 'team', expires: '2026-01-01' },
    ],
  });
  const f = [
    finding({ id: 'CVE-W', severity: 'Critical' }),
    finding({ id: 'CVE-X', severity: 'Critical' }),
  ];

  it('removes a waived finding from the unresolved set and the gate', () => {
    const result = prioritize(f, feeds(['CVE-W', 'CVE-X']), { ...OPTS, waivers });
    expect(result.waived.map((w) => w.id)).toEqual(['CVE-W']);
    expect(result.items.map((i) => i.id)).toEqual(['CVE-X']);
    expect(
      evaluateGate(result.items, { failOn: 'critical', epssThreshold: 0.1 }).blocking,
    ).toHaveLength(1);
  });

  it('ignores an expired waiver and reports it', () => {
    const result = prioritize(f, feeds(), { ...OPTS, waivers });
    expect(result.expiredWaivers.map((w) => w.id)).toEqual(['CVE-X']);
    expect(result.items.map((i) => i.id)).toContain('CVE-X');
  });

  it('treats an expiry equal to the as-of date as expired', () => {
    const w = parseWaivers({
      waivers: [{ id: 'CVE-W', package: 'pkg', reason: 'r', owner: 'o', expires: '2026-11-25' }],
    });
    expect(
      prioritize([f[0] as (typeof f)[number]], feeds(), { ...OPTS, waivers: w }).waived,
    ).toHaveLength(0);
  });

  it('rejects a waiver with no reason or expiry', () => {
    expect(() => parseWaivers({ waivers: [{ id: 'CVE-W', package: 'pkg' }] })).toThrow();
  });
});

describe('gate audit record', () => {
  it('appends one hash-chained line per decision', async () => {
    const { writeGateAudit } = await import('../src/gate.ts');
    const path = join(mkdtempSync(join(tmpdir(), 'gate-')), 'audit.jsonl');
    const result = evaluateGate([], { failOn: 'critical', epssThreshold: 0.1 });
    writeGateAudit(
      path,
      result,
      { failOn: 'critical', epssThreshold: 0.1 },
      () => new Date('2026-11-25T00:00:00Z'),
    );
    const line = JSON.parse(readFileSync(path, 'utf8').trim()) as {
      action: string;
      decision: string;
    };
    expect(line.action).toBe('sbom-triage.gate');
    expect(line.decision).toBe('pass');
  });
});
