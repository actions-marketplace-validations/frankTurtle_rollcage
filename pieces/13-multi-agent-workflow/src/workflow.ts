import { canonicalJson, extractJson, sha256Hex, type AuditLogger } from '@adl/shared';
import {
  createAssembler,
  manualClock,
  pipeline,
  seededRng,
  sequentialIds,
  toolCalls,
  type ContextAssembler,
  type Handoff as PipelineHandoff,
  type ModelProvider,
  type Outcome,
  type PipelineStage,
  type RunLedger,
  type StageInput,
} from 'escapement';
import { z } from 'zod';
import type { AgentDef } from './agents.js';
import { hashChange, type ProposedChange } from './approval.js';
import type { Role } from './roles.js';
import { buildToolRegistry } from './tools.js';
import type { TestRunner, Workspace } from './workspace.js';

export type Decision = 'proceed' | 'rework' | 'approve' | 'request_changes' | 'halt';
export type RunStatus = 'awaiting-approval' | 'halted' | 'failed';

export interface ToolCallSummary {
  name: string;
  argsHash: string;
  ok: boolean;
}

/** One agent run, as the audit trail sees it. */
export interface Handoff {
  seq: number;
  agent: Role;
  inputHash: string;
  output: string;
  outputHash: string;
  toolCalls: ToolCallSummary[];
  decision: Decision;
  ledgerKey: string;
  ledgerDigest: string;
}

export interface RecordConfig {
  branch: string;
  commitMessage: string;
  maxReworkRounds: number;
  maxSteps: number;
}

export interface RunRecord {
  version: 1;
  runId: string;
  task: string;
  config: RecordConfig;
  status: RunStatus;
  reason?: string;
  reworkRounds: number;
  handoffs: Handoff[];
  ledgers: Record<string, RunLedger>;
  change?: ProposedChange;
}

export interface WorkflowOptions {
  runId: string;
  task: string;
  agents: Record<Role, AgentDef>;
  workspace: Workspace;
  runTests: TestRunner;
  /** The model for one agent run. `seq` is the handoff number, so a replay can serve recorded turns. */
  providerFor: (role: Role, seq: number) => ModelProvider;
  audit?: AuditLogger;
  branch: string;
  commitMessage?: string;
  maxReworkRounds?: number;
  maxSteps?: number;
}

const Verdict = z.object({
  verdict: z.enum(['approve', 'request_changes']),
  findings: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
});

export const hashInput = (agent: Role, goal: string): string =>
  sha256Hex(canonicalJson({ agent, goal }));

export const outputOf = (outcome: Outcome | null): string =>
  outcome?.status === 'completed'
    ? outcome.output
    : `[run ${outcome?.status ?? 'unfinished'}] ${outcome && 'error' in outcome ? outcome.error.message : 'no outcome'}`;

export const summarizeToolCalls = (ledger: RunLedger): ToolCallSummary[] =>
  toolCalls(ledger).map((c) => ({
    name: c.name,
    argsHash: sha256Hex(canonicalJson(c.args)),
    ok: c.ok,
  }));

/** The same context assembler for a live run and for an eval case. */
export const makeAssembler = (agent: AgentDef): ContextAssembler =>
  createAssembler({
    budget: { total: 32_000, reserveForOutput: 1_000 },
    systemPrompt: agent.prompt,
  });

const list = (files: string[]): string => files.map((f) => `- ${f}`).join('\n');

/** Run planner, implementer, tester and reviewer as an Escapement pipeline, with a bounded rework loop. */
export async function runWorkflow(options: WorkflowOptions): Promise<RunRecord> {
  const config: RecordConfig = {
    branch: options.branch,
    commitMessage: options.commitMessage ?? `agent change for ${options.runId}`,
    maxReworkRounds: options.maxReworkRounds ?? 1,
    maxSteps: options.maxSteps ?? 8,
  };
  const handoffs: Handoff[] = [];
  const ledgers: Record<string, RunLedger> = {};
  const toolDeps = { workspace: options.workspace, runTests: options.runTests };
  const task = `Task:\n${options.task}`;

  let reworkRounds = 0;
  let plan = '';
  let feedback = '';
  let testReport = '';
  let stopReason: string | undefined;
  let haltReason: string | undefined;
  let noChange = false;

  /** One agent run, as Escapement builds it for a pipeline stage. */
  const stage =
    (role: Role, goal: (input: StageInput) => string): PipelineStage =>
    (input) => {
      const agent = options.agents[role];
      return {
        goal: goal(input),
        provider: options.providerFor(role, input.seq),
        tools: buildToolRegistry(agent, toolDeps),
        assembler: makeAssembler(agent),
        config: { budget: { maxSteps: config.maxSteps } },
        deps: {
          clock: manualClock(0),
          rng: seededRng(`${options.runId}-${input.seq}-${role}`),
          ids: sequentialIds(),
        },
      };
    };

  /** What a finished run means for the workflow: proceed, rework, approve, request changes or halt. */
  function decide(h: PipelineHandoff, output: string): [Decision, string?] {
    const role = h.stage as Role;
    if (h.outcome.status !== 'completed') return ['halt', `${role} run ${h.outcome.status}`];
    switch (role) {
      case 'planner':
        return ['proceed'];
      case 'implementer':
        noChange = Object.keys(options.workspace.changes()).length === 0;
        return noChange ? ['halt', 'implementer made no change'] : ['proceed'];
      case 'tester': {
        const last = toolCalls(h.ledger)
          .filter((c) => c.name === 'run_tests')
          .at(-1);
        if (!last) return ['rework', 'tester did not run the tests'];
        const result = last.ok
          ? (JSON.parse(last.content) as { passed: boolean; summary: string })
          : { passed: false, summary: last.content };
        return result.passed ? ['proceed'] : ['rework', `tests failed: ${result.summary}`];
      }
      case 'reviewer': {
        const verdict = parseVerdict(output);
        if (!verdict) return ['request_changes', 'reviewer verdict was not valid JSON'];
        return verdict.verdict === 'approve'
          ? ['approve']
          : ['request_changes', verdict.findings.join('\n') || 'reviewer requested changes'];
      }
    }
  }

  /** Record a finished run in the audit trail and the run record, and return its decision. */
  function settle(h: PipelineHandoff): { decision: Decision; reason?: string } {
    const role = h.stage as Role;
    const key = `${h.seq}-${role}`;
    const output = outputOf(h.outcome);
    const [decision, reason] = decide(h, output);
    if (decision === 'halt') haltReason = reason;
    const goal = h.ledger.goal;
    const handoff: Handoff = {
      seq: h.seq,
      agent: role,
      inputHash: hashInput(role, goal),
      output,
      outputHash: sha256Hex(output),
      toolCalls: summarizeToolCalls(h.ledger),
      decision,
      ledgerKey: key,
      ledgerDigest: h.ledgerDigest,
    };
    handoffs.push(handoff);
    ledgers[key] = h.ledger;
    options.audit?.append({
      actor: `agent:${role}`,
      action: 'handoff',
      input: { agent: role, goal },
      decision,
      detail: {
        runId: options.runId,
        seq: h.seq,
        ledgerKey: key,
        outputHash: handoff.outputHash,
        ledgerDigest: handoff.ledgerDigest,
        toolCalls: handoff.toolCalls.map((t) => t.name),
        ...(reason ? { reason } : {}),
      },
    });
    return { decision, ...(reason ? { reason } : {}) };
  }

  /** Send the work back to the implementer, or stop when the rework limit is spent. */
  function rework(why: string): string | null {
    if (reworkRounds >= config.maxReworkRounds) {
      stopReason = `rework limit reached (${config.maxReworkRounds}): ${why}`;
      return null;
    }
    reworkRounds += 1;
    feedback = why;
    return 'implementer';
  }

  const result = await pipeline({
    id: options.runId,
    start: 'planner',
    maxHandoffs: 1 + 3 * (config.maxReworkRounds + 1), // the planner, then three agents per round,
    stages: {
      planner: stage('planner', () => task),
      implementer: stage(
        'implementer',
        () =>
          `${task}\n\nPlan:\n${plan}${feedback ? `\n\nReview feedback to fix:\n${feedback}` : ''}`,
      ),
      tester: stage(
        'tester',
        ({ prior }) =>
          `${task}\n\nChanged files:\n${list(Object.keys(options.workspace.changes()))}\n\nImplementer report:\n${outputOf(prior.at(-1)?.outcome ?? null)}`,
      ),
      reviewer: stage(
        'reviewer',
        () =>
          `${task}\n\nPlan:\n${plan}\n\nChanged files:\n${list(Object.keys(options.workspace.changes()))}\n\nTest report:\n${testReport}`,
      ),
    },
    next: (h) => {
      const { decision, reason } = settle(h);
      const output = outputOf(h.outcome);
      switch (h.stage) {
        case 'planner':
          plan = output;
          return 'implementer';
        case 'implementer':
          return decision === 'halt' ? null : 'tester';
        case 'tester':
          if (decision === 'rework') return rework(reason ?? '');
          testReport = output;
          return 'reviewer';
        default:
          return decision === 'request_changes' ? rework(reason ?? '') : null;
      }
    },
  });

  // A run that does not complete stops the pipeline before `next`, so its handoff is settled here.
  const stopped = result.handoffs.at(-1);
  if (stopped && stopped.outcome.status !== 'completed') settle(stopped);

  const last = handoffs.at(-1);
  const finish = (status: RunStatus, reason?: string, change?: ProposedChange): RunRecord => ({
    version: 1,
    runId: options.runId,
    task: options.task,
    config,
    status,
    ...(reason ? { reason } : {}),
    reworkRounds,
    handoffs,
    ledgers,
    ...(change ? { change } : {}),
  });

  if (stopReason) return finish('halted', stopReason);
  if (last?.decision === 'approve') {
    const change: ProposedChange = {
      branch: config.branch,
      message: config.commitMessage,
      files: options.workspace.changes(),
      hash: '',
    };
    change.hash = hashChange(change);
    return finish('awaiting-approval', undefined, change);
  }
  return finish(noChange ? 'halted' : 'failed', haltReason);
}

function parseVerdict(output: string): z.infer<typeof Verdict> | undefined {
  try {
    const parsed = Verdict.safeParse(extractJson(output));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const serializeRecord = (record: RunRecord): string =>
  `${JSON.stringify(record, null, 2)}\n`;

export function parseRecord(text: string): RunRecord {
  const record = JSON.parse(text) as RunRecord;
  if (record.version !== 1)
    throw new Error(`unsupported run record version: ${String(record.version)}`);
  return record;
}
