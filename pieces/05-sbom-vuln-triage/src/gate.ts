import { AuditLogger } from '@adl/shared';
import { meetsSeverity } from './prioritize.js';
import type { PrioritizedFinding } from './prioritize.js';

export interface GateOptions {
  /** Severity threshold: critical, high, medium or low. */
  failOn: string;
  epssThreshold: number;
}

export interface BlockingFinding extends PrioritizedFinding {
  why: string;
}

export interface GateResult {
  pass: boolean;
  blocking: BlockingFinding[];
}

/**
 * Fail when an unresolved finding at or above `failOn` is in KEV or has an EPSS score above the
 * threshold. Severity alone never fails the gate. Pass in the unresolved set (waivers removed).
 */
export function evaluateGate(items: PrioritizedFinding[], opts: GateOptions): GateResult {
  const blocking: BlockingFinding[] = [];
  for (const f of items) {
    if (!meetsSeverity(f.severity, opts.failOn)) continue;
    const why: string[] = [];
    if (f.inKev) why.push('in KEV');
    if (f.epss !== null && f.epss > opts.epssThreshold) {
      why.push(`EPSS ${f.epss.toFixed(2)} above ${opts.epssThreshold.toFixed(2)}`);
    }
    if (why.length > 0) blocking.push({ ...f, why: why.join(', ') });
  }
  return { pass: blocking.length === 0, blocking };
}

export function writeGateAudit(
  path: string,
  result: GateResult,
  opts: GateOptions,
  now?: () => Date,
): void {
  new AuditLogger(path, now).append({
    actor: 'sbom-vuln-triage',
    action: 'sbom-triage.gate',
    input: { ...opts, blocking: result.blocking.map((b) => b.key) },
    decision: result.pass ? 'pass' : 'fail',
    detail: { blockingCount: result.blocking.length },
  });
}
