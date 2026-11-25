import { describe, expect, it } from 'vitest';
import { runGate } from '../src/gate.ts';
import { aggregateMetric, GateReportSchema, renderMetric } from '../src/report.ts';
import type { VerifySpec } from '../src/types.ts';
import { fail, fakeRunner, ok, workdir } from './helpers.ts';

function signedSpec(w: ReturnType<typeof workdir>, name: string): VerifySpec {
  const artifact = w.file(name, name);
  w.file(`${name}.sigstore.json`, '{}');
  return {
    mode: 'key',
    artifact,
    bundle: `${artifact}.sigstore.json`,
    publicKey: 'signer.pub',
    allowNoTlog: true,
  };
}

describe('AC-5: gate decision', () => {
  it('allows only when every artifact verifies', async () => {
    const w = workdir();
    const specs = [signedSpec(w, 'a.tgz'), signedSpec(w, 'b.tgz')];
    const { runner } = fakeRunner(() => ok('', 'Verified OK'));
    const report = await runGate(specs, runner);
    expect(report).toMatchObject({ decision: 'allow', total: 2, verified: 2, percent: 100 });
    expect(GateReportSchema.parse(report)).toEqual(report);
  });

  it('blocks when any artifact fails, and still checks the rest', async () => {
    const w = workdir();
    const specs = [signedSpec(w, 'a.tgz'), signedSpec(w, 'b.tgz'), signedSpec(w, 'c.tgz')];
    const { runner, calls } = fakeRunner((call) =>
      call.args.includes(specs[1]?.artifact ?? '')
        ? fail('invalid signature')
        : ok('', 'Verified OK'),
    );
    const report = await runGate(specs, runner);
    expect(report.decision).toBe('block');
    expect(report).toMatchObject({ total: 3, verified: 2, percent: 67 });
    expect(report.results.map((r) => r.status)).toEqual(['verified', 'failed', 'verified']);
    expect(calls).toHaveLength(3);
  });

  it('blocks when given no artifacts', async () => {
    const { runner, calls } = fakeRunner(() => ok('', 'Verified OK'));
    const report = await runGate([], runner);
    expect(report).toMatchObject({ decision: 'block', total: 0, verified: 0, percent: 0 });
    expect(calls).toHaveLength(0);
  });

  it('does not let one artifact verify twice by being listed twice', async () => {
    const w = workdir();
    const spec = signedSpec(w, 'a.tgz');
    const { runner, calls } = fakeRunner(() => ok('', 'Verified OK'));
    const report = await runGate([spec, spec], runner);
    expect(report.total).toBe(1);
    expect(calls).toHaveLength(1);
  });
});

describe('AC-6: metric', () => {
  const report = (verified: number, total: number) =>
    GateReportSchema.parse({
      decision: verified === total && total > 0 ? 'allow' : 'block',
      total,
      verified,
      percent: total === 0 ? 0 : Math.round((verified / total) * 100),
      results: [],
    });

  it('is verified over total', () => {
    expect(aggregateMetric([report(1, 3)])).toEqual({ verified: 1, total: 3, percent: 33 });
  });

  it('aggregates several reports by summing counts', () => {
    expect(aggregateMetric([report(2, 2), report(0, 2)])).toEqual({
      verified: 2,
      total: 4,
      percent: 50,
    });
  });

  it('is zero percent, not NaN, for no artifacts', () => {
    expect(aggregateMetric([])).toEqual({ verified: 0, total: 0, percent: 0 });
  });

  it('renders a one-line sentence', () => {
    expect(renderMetric({ verified: 1, total: 3, percent: 33 })).toBe(
      'Signed and verified: 1 of 3 deployed artifacts (33%)',
    );
  });

  it('rejects a report that claims more verified than total', () => {
    expect(() =>
      GateReportSchema.parse({
        decision: 'allow',
        total: 1,
        verified: 2,
        percent: 200,
        results: [],
      }),
    ).toThrow();
  });
});
