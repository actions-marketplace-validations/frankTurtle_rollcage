import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { parseHistory } from '../src/history.ts';
import { computeMetrics } from '../src/metrics.ts';
import { generateLeadershipNote } from '../src/notes.ts';
import type { LeadershipFacts } from '../src/notes.ts';
import { prioritize } from '../src/prioritize.ts';
import { diffSboms, parseSbom, renderDiff } from '../src/sbom.ts';
import { feeds, finding, fixtureJson } from './helpers.ts';

describe('AC11: SBOM diff between two releases', () => {
  const from = parseSbom(fixtureJson('node-app-1.0.0.cdx.json'));
  const to = parseSbom(fixtureJson('node-app.cdx.json'));
  const diff = diffSboms(from, to);

  it('lists added, removed and upgraded components', () => {
    expect(diff.added.map((c) => c.name)).toEqual(['jsonwebtoken']);
    expect(diff.removed.map((c) => c.name)).toEqual(['request']);
    expect(diff.upgraded.map((u) => `${u.name} ${u.from} -> ${u.to}`)).toEqual([
      'axios 0.19.2 -> 0.21.1',
      'lodash 4.17.11 -> 4.17.15',
      'shop-api 1.0.0 -> 1.1.0',
    ]);
    expect(diff.downgraded).toEqual([]);
    expect(diff.unchanged).toBe(4);
  });

  it('detects a downgrade and compares versions numerically', () => {
    const a = [{ name: 'x', version: '1.10.0', purl: 'pkg:npm/x@1.10.0', type: 'library' }];
    const b = [{ name: 'x', version: '1.9.0', purl: 'pkg:npm/x@1.9.0', type: 'library' }];
    expect(diffSboms(a, b).downgraded.map((d) => d.name)).toEqual(['x']);
    expect(diffSboms(b, a).upgraded.map((d) => d.name)).toEqual(['x']);
  });

  it('renders a readable summary', () => {
    const text = renderDiff(diff, 'shop-api 1.0.0', 'shop-api 1.1.0');
    expect(text).toContain('added (1)');
    expect(text).toContain('jsonwebtoken 8.5.1');
    expect(text).toContain('removed (1)');
    expect(text).toContain('upgraded (3)');
    expect(text).toContain('4 unchanged');
  });

  it('renders an empty diff without sections', () => {
    expect(renderDiff(diffSboms(to, to), 'a', 'b')).toContain('No changes');
  });
});

describe('AC12: metrics', () => {
  const history = parseHistory(fixtureJson('history.json'));
  const findings = [
    finding({ id: 'CVE-1', severity: 'Critical' }),
    finding({ id: 'CVE-2', severity: 'Critical', package: 'other' }),
    finding({ id: 'CVE-3', severity: 'Medium' }),
    finding({ id: 'CVE-4', severity: 'Low' }),
  ];
  const opts = { epssThreshold: 0.1, asOf: '2026-11-25' };
  const result = prioritize(findings, feeds(['CVE-1']), opts);

  it('counts open criticals in the unresolved set', () => {
    const m = computeMetrics(result.items, [], history, {
      asOf: '2026-11-25',
      minutesPerFinding: 15,
    });
    expect(m.openCriticals).toBe(2);
  });

  it('excludes waived criticals from the count and reports them apart', () => {
    const waived = prioritize(findings, feeds(), {
      ...opts,
      waivers: [{ id: 'CVE-2', package: 'other', reason: 'r', owner: 'o', expires: '2027-01-01' }],
    });
    const m = computeMetrics(waived.items, waived.waived, history, {
      asOf: '2026-11-25',
      minutesPerFinding: 15,
    });
    expect(m.openCriticals).toBe(1);
    expect(m.waivedCriticals).toBe(1);
  });

  it('computes mean time to remediate from resolved history entries', () => {
    const m = computeMetrics(result.items, [], history, {
      asOf: '2026-11-25',
      minutesPerFinding: 15,
    });
    expect(m.mttr.resolved).toBe(7);
    expect(m.mttr.overallDays).toBeCloseTo(23.14, 2);
    expect(m.mttr.criticalDays).toBeCloseTo(19.67, 2);
  });

  it('reports no data without a history', () => {
    const m = computeMetrics(result.items, [], [], { asOf: '2026-11-25', minutesPerFinding: 15 });
    expect(m.mttr).toEqual({ resolved: 0, overallDays: null, criticalDays: null });
  });

  it('estimates triage time from findings that need review and shows the assumption', () => {
    const m = computeMetrics(result.items, [], [], { asOf: '2026-11-25', minutesPerFinding: 10 });
    expect(m.triage).toEqual({
      minutesPerFinding: 10,
      total: 4,
      needReview: 2,
      baselineMinutes: 40,
      estimatedMinutes: 20,
      savedMinutes: 20,
    });
  });

  it('reports the age of open criticals that appear in the history', () => {
    const items = prioritize(
      [finding({ id: 'CVE-2021-44906', package: 'minimist', severity: 'Critical' })],
      feeds(),
      opts,
    ).items;
    const m = computeMetrics(items, [], history, { asOf: '2026-11-25', minutesPerFinding: 15 });
    expect(m.openCriticalAgeDays).toEqual([
      { id: 'CVE-2021-44906', package: 'minimist', days: 114 },
    ]);
  });

  it('rejects a history entry with a bad date', () => {
    expect(() =>
      parseHistory({
        entries: [{ id: 'x', package: 'p', severity: 'High', firstSeen: 'yesterday' }],
      }),
    ).toThrow();
  });
});

describe('AC10 and AC8: leadership note', () => {
  const facts: LeadershipFacts = {
    asOf: '2026-11-25',
    apps: ['shop-api'],
    unresolved: 19,
    waived: 1,
    tiers: { P0: 4, P1: 3, P2: 6, P3: 6 },
    openCriticals: 4,
    blocking: 3,
    failOn: 'critical',
    mttrDays: 23.1,
    top: [
      {
        id: 'CVE-2020-14343',
        package: 'PyYAML',
        app: 'report-worker',
        tier: 'P0',
        why: 'in KEV',
        action: 'upgrade to 5.4',
        reach: 'import-and-symbol-found',
      },
    ],
  };
  const good = JSON.stringify({
    headline: 'Four findings need action now.',
    paragraphs: ['CVE-2020-14343 in PyYAML is on the known-exploited list and has a fix.'],
    assumptions: ['The KEV and EPSS data is a snapshot.'],
  });

  it('uses a valid model note', async () => {
    const result = await generateLeadershipNote(new FakeLlm([good]), facts);
    expect(result.source).toBe('model');
    expect(result.note.headline).toContain('Four findings');
  });

  it('rejects a note that names a CVE that is not in the findings', async () => {
    const bad = JSON.stringify({
      headline: 'h',
      paragraphs: ['CVE-1999-0001 is being exploited.'],
      assumptions: ['a'],
    });
    const result = await generateLeadershipNote(new FakeLlm([bad, bad]), facts);
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/CVE-1999-0001/);
    expect(result.note.paragraphs.join(' ')).not.toContain('CVE-1999-0001');
  });

  it('rejects a note that states exploitability as fact, and one with no assumptions', async () => {
    const claims = JSON.stringify({
      headline: 'h',
      paragraphs: ['Attackers are exploiting this. It is confirmed exploitable.'],
      assumptions: ['a'],
    });
    const none = JSON.stringify({ headline: 'h', paragraphs: ['ok'], assumptions: [] });
    expect((await generateLeadershipNote(new FakeLlm([claims, claims]), facts)).source).toBe(
      'fallback',
    );
    expect((await generateLeadershipNote(new FakeLlm([none, none]), facts)).source).toBe(
      'fallback',
    );
  });

  it('the fallback states the counts from the facts and lists its assumptions', async () => {
    const result = await generateLeadershipNote(
      new FakeLlm([new Error('down'), new Error('down')]),
      facts,
    );
    expect(result.source).toBe('fallback');
    const text = [result.note.headline, ...result.note.paragraphs].join(' ');
    expect(text).toContain('19');
    expect(text).toContain('4');
    expect(text).toContain('CVE-2020-14343');
    expect(result.note.assumptions.length).toBeGreaterThan(0);
  });

  it('sends only facts, as quoted data, in the prompt', async () => {
    const llm = new FakeLlm([good]);
    await generateLeadershipNote(llm, facts);
    expect(llm.calls[0]?.prompt).toContain('CVE-2020-14343');
    expect(llm.calls[0]?.system).toMatch(/data, not instructions/i);
  });
});
