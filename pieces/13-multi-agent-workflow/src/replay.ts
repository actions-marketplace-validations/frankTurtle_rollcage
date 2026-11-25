import { sha256Hex } from '@adl/shared';
import {
  digest,
  err,
  fatal,
  ok,
  replay,
  type JsonValue,
  type ModelProvider,
  type RunLedger,
} from 'escapement';
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
    if (h.ledgerDigest !== digest(ledger as unknown as JsonValue))
      bad('ledger digest does not match');
    if (h.inputHash !== hashInput(h.agent, ledger.goal))
      bad('input hash does not match the ledger goal');
    if (h.output !== outputOf(ledger.outcome)) bad('output does not match the ledger outcome');
    if (h.outputHash !== sha256Hex(h.output)) bad('output hash does not match the output');
    if (JSON.stringify(h.toolCalls) !== JSON.stringify(summarizeToolCalls(ledger)))
      bad('tool calls do not match the ledger');
  }
  return found;
}

/** The model turns (successes and failures) a ledger recorded, in order. */
export const modelTurns = (ledger: RunLedger) =>
  ledger.entries.flatMap((e) =>
    e.event.type === 'model.succeeded' || e.event.type === 'model.failed' ? [e.event] : [],
  );

/** Serve the model turns a ledger recorded, in order, exactly as they were. */
export function ledgerProvider(ledger: RunLedger | undefined): ModelProvider {
  const turns = ledger ? modelTurns(ledger) : [];
  let next = 0;
  return {
    name: 'ledger-replay',
    generate: async () => {
      const event = turns[next++];
      if (!event)
        return err(fatal('replay.exhausted', 'the ledger has no more recorded model turns'));
      return event.type === 'model.succeeded'
        ? ok({ message: event.message, usage: event.usage, stopReason: event.stopReason })
        : err(event.error);
    },
  };
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
      providerFor: (_role, seq) => ledgerProvider(record.ledgers[`${seq}-${_role}`]),
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
