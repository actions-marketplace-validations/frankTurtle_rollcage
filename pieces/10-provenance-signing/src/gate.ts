import { percentOf } from './report.ts';
import type { GateReport } from './report.ts';
import type { CommandRunner, VerifySpec } from './types.ts';
import { verifyArtifact } from './verify.ts';

/**
 * The deploy gate. Allows only when at least one artifact was checked and every one verified.
 * Artifacts listed twice are checked once, so a duplicate cannot inflate the metric.
 */
export async function runGate(
  specs: readonly VerifySpec[],
  runner: CommandRunner,
): Promise<GateReport> {
  const unique = [...new Map(specs.map((s) => [s.artifact, s])).values()];
  const results = await Promise.all(unique.map((spec) => verifyArtifact(spec, runner)));
  const verified = results.filter((r) => r.status === 'verified').length;
  return {
    decision: results.length > 0 && verified === results.length ? 'allow' : 'block',
    total: results.length,
    verified,
    percent: percentOf(verified, results.length),
    results,
  };
}
