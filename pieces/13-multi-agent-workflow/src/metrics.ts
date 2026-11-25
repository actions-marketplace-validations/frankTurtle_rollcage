import type { AuditRecord } from '@adl/shared';
import { replay } from 'escapement';
import { verifyHandoffs } from './replay.js';
import { ROLES } from './roles.js';
import type { RunRecord } from './workflow.js';

export interface TraceCheck {
  complete: boolean;
  missing: string[];
}

/**
 * A trace is complete when all four roles have a handoff, every handoff matches its ledger, every
 * ledger replays, and the audit log holds a matching entry for every handoff.
 */
export function traceComplete(record: RunRecord, audit: AuditRecord[]): TraceCheck {
  const missing: string[] = [];
  for (const role of ROLES) {
    if (!record.handoffs.some((h) => h.agent === role)) missing.push(`handoff for ${role}`);
  }
  for (const m of verifyHandoffs(record)) missing.push(`handoff ${m.seq}: ${m.what}`);
  for (const [key, ledger] of Object.entries(record.ledgers)) {
    if (!replay(ledger).ok) missing.push(`ledger ${key} does not replay`);
  }
  for (const h of record.handoffs) {
    const found = audit.some(
      (r) =>
        r.action === 'handoff' &&
        r.inputHash === h.inputHash &&
        r.detail?.['runId'] === record.runId &&
        r.detail['seq'] === h.seq &&
        r.detail['ledgerDigest'] === h.ledgerDigest,
    );
    if (!found) missing.push(`audit entry for handoff ${h.seq}`);
  }
  return { complete: missing.length === 0, missing };
}

export interface Metrics {
  runs: number;
  /** Runs that produced a change for a human to approve. */
  withChange: number;
  completeTrace: number;
  completeTracePct: number;
  reviewed: number;
  reworked: number;
  reworkRatePct: number;
}

const pct = (part: number, whole: number): number =>
  whole === 0 ? 0 : Math.round((1000 * part) / whole) / 10;

export function computeMetrics(records: RunRecord[], audit: AuditRecord[]): Metrics {
  const changed = records.filter((r) => r.change);
  const completeTrace = changed.filter((r) => traceComplete(r, audit).complete).length;
  const reviewed = records.filter((r) => r.handoffs.some((h) => h.agent === 'reviewer'));
  const reworked = reviewed.filter((r) =>
    r.handoffs.some((h) => h.agent === 'reviewer' && h.decision === 'request_changes'),
  ).length;
  return {
    runs: records.length,
    withChange: changed.length,
    completeTrace,
    completeTracePct: pct(completeTrace, changed.length),
    reviewed: reviewed.length,
    reworked,
    reworkRatePct: pct(reworked, reviewed.length),
  };
}
