import { sha256Hex } from '@adl/shared';
import { replay, replayProvider, verifyPipeline } from 'escapement';
import type { AgentDef } from './agents.js';
import type { Role } from './roles.js';
import {
  hashInput,
  outputOf,
  runWorkflow,
  serializeRecord,
  summarizeToolCalls,
  type RunRecord,
} from './workflow.js';
import type { TestRunner, Workspace } from './workspace.js';

export interface Mismatch {
  seq: number;
  what: string;
}

export interface ReplayReport {
  ok: boolean;
  /** Every ledger reproduces under Escapement's reducer replay. */
  ledgersOk: boolean;
  handoffMismatches: Mismatch[];
  /** Re-running the workflow from the recorded model turns gives a byte-identical record. */
  reexecutionIdentical: boolean;
  note?: string;
}

/** Check each handoff against the ledger it points to. */
export function verifyHandoffs(record: RunRecord): Mismatch[] {
  const found: Mismatch[] = [];
  for (const h of record.handoffs) {
    const bad = (what: string) => found.push({ seq: h.seq, what });
    const ledger = record.ledgers[h.ledgerKey];
    if (!ledger) {
      bad('ledger is missing');
      continue;
    }
    if (h.inputHash !== hashInput(h.agent, ledger.goal))
      bad('input hash does not match the ledger goal');
    if (h.output !== outputOf(ledger.outcome)) bad('output does not match the ledger outcome');
    if (h.outputHash !== sha256Hex(h.output)) bad('output hash does not match the output');
    if (JSON.stringify(h.toolCalls) !== JSON.stringify(summarizeToolCalls(ledger)))
      bad('tool calls do not match the ledger');
  }
  return [...found, ...pipelineProblems(record)].sort((a, b) => a.seq - b.seq);
}

/** Escapement's own check of the chain: order, parent links, ledger owner and digest, replay. */
function pipelineProblems(record: RunRecord): Mismatch[] {
  const linked = record.handoffs.flatMap((h) => {
    const ledger = record.ledgers[h.ledgerKey];
    return ledger?.outcome
      ? [
          {
            seq: h.seq,
            stage: h.agent,
            runId: ledger.runId,
            parentRunId: ledger.parentRunId ?? null,
            outcome: ledger.outcome,
            ledger,
            ledgerDigest: h.ledgerDigest,
          },
        ]
      : [];
  });
  if (linked.length !== record.handoffs.length)
    return [
      {
        seq: 0,
        what: 'a ledger is missing or has no outcome, so the pipeline links were not checked',
      },
    ];
  return verifyPipeline({ id: record.runId, status: 'completed', handoffs: linked }).map((p) => ({
    seq: p.seq,
    what: p.problem,
  }));
}

export interface ReplayDeps {
  agents: Record<Role, AgentDef>;
  /** A fresh workspace with the same starting files the run began with. */
  workspace: Workspace;
  runTests: TestRunner;
}

export async function replayRecord(record: RunRecord, deps: ReplayDeps): Promise<ReplayReport> {
  const ledgersOk = Object.values(record.ledgers).every((l) => replay(l).ok);
  const handoffMismatches = verifyHandoffs(record);

  let reexecutionIdentical = false;
  let note: string | undefined;
  try {
    const again = await runWorkflow({
      ...deps,
      runId: record.runId,
      task: record.task,
      branch: record.config.branch,
      commitMessage: record.config.commitMessage,
      maxReworkRounds: record.config.maxReworkRounds,
      maxSteps: record.config.maxSteps,
      providerFor: (role, seq) => {
        const ledger = record.ledgers[`${seq}-${role}`];
        if (!ledger) throw new Error(`the ledger for ${seq}-${role} is missing`);
        return replayProvider(ledger);
      },
    });
    reexecutionIdentical = serializeRecord(again) === serializeRecord(record);
    if (!reexecutionIdentical) note = 're-execution produced a different record';
  } catch (error) {
    note = `re-execution failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  return {
    ok: ledgersOk && handoffMismatches.length === 0 && reexecutionIdentical,
    ledgersOk,
    handoffMismatches,
    reexecutionIdentical,
    ...(note ? { note } : {}),
  };
}
