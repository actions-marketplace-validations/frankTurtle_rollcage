import { canonicalJson, extractJson, sha256Hex, type AuditLogger } from '@adl/shared';
import {
  createAssembler,
  digest,
  manualClock,
  run,
  seededRng,
  sequentialIds,
  toolCalls,
  type ContextAssembler,
  type JsonValue,
  type ModelProvider,
  type Outcome,
  type RunLedger,
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

interface StepResult {
  handoff: Handoff;
  ledger: RunLedger;
}

const list = (files: string[]): string => files.map((f) => `- ${f}`).join('\n');

/** Run planner, implementer, tester and reviewer in order, with a bounded rework loop. */
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

  async function step(
    role: Role,
    goal: string,
    decide: (ledger: RunLedger, output: string) => [Decision, string?],
  ): Promise<StepResult & { reason?: string }> {
    const seq = handoffs.length + 1;
    const key = `${seq}-${role}`;
    const agent = options.agents[role];
    const { ledger, outcome } = await run({
      goal,
      provider: options.providerFor(role, seq),
      tools: buildToolRegistry(agent, toolDeps),
      assembler: makeAssembler(agent),
      config: { budget: { maxSteps: config.maxSteps } },
      deps: {
        clock: manualClock(0),
        rng: seededRng(`${options.runId}-${key}`),
        ids: sequentialIds(),
      },
      runId: `${options.runId}-${key}`,
      seed: `${options.runId}-${key}`,
    });
    const output = outputOf(outcome);
    const [decision, reason] =
      outcome.status === 'completed'
        ? decide(ledger, output)
        : (['halt', `${role} run ${outcome.status}`] as [Decision, string]);
    const handoff: Handoff = {
      seq,
      agent: role,
      inputHash: hashInput(role, goal),
      output,
      outputHash: sha256Hex(output),
      toolCalls: summarizeToolCalls(ledger),
      decision,
      ledgerKey: key,
      ledgerDigest: digest(ledger as unknown as JsonValue),
    };
    handoffs.push(handoff);
    ledgers[key] = ledger;
    options.audit?.append({
      actor: `agent:${role}`,
      action: 'handoff',
      input: { agent: role, goal },
      decision,
      detail: {
        runId: options.runId,
        seq,
        ledgerKey: key,
        outputHash: handoff.outputHash,
        ledgerDigest: handoff.ledgerDigest,
        toolCalls: handoff.toolCalls.map((t) => t.name),
        ...(reason ? { reason } : {}),
      },
    });
    return { handoff, ledger, ...(reason ? { reason } : {}) };
  }

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

  let reworkRounds = 0;
  const task = `Task:\n${options.task}`;

  const planned = await step('planner', task, () => ['proceed']);
  if (planned.handoff.decision === 'halt')
    return finish('failed', planned.reason ?? 'planner failed');
  const plan = planned.handoff.output;

  let feedback = '';
  for (;;) {
    const implGoal = `${task}\n\nPlan:\n${plan}${feedback ? `\n\nReview feedback to fix:\n${feedback}` : ''}`;
    const impl = await step('implementer', implGoal, () =>
      Object.keys(options.workspace.changes()).length === 0
        ? ['halt', 'implementer made no change']
        : ['proceed'],
    );
    if (impl.handoff.decision === 'halt') {
      return finish(impl.reason?.endsWith('no change') ? 'halted' : 'failed', impl.reason);
    }
    const files = Object.keys(options.workspace.changes());

    const tested = await step(
      'tester',
      `${task}\n\nChanged files:\n${list(files)}\n\nImplementer report:\n${impl.handoff.output}`,
      (ledger) => {
        const last = toolCalls(ledger)
          .filter((c) => c.name === 'run_tests')
          .at(-1);
        if (!last) return ['rework', 'tester did not run the tests'];
        const result = last.ok
          ? (JSON.parse(last.content) as { passed: boolean; summary: string })
          : { passed: false, summary: last.content };
        return result.passed ? ['proceed'] : ['rework', `tests failed: ${result.summary}`];
      },
    );
    let why = tested.reason ?? '';
    if (tested.handoff.decision === 'halt') return finish('failed', tested.reason);

    if (tested.handoff.decision === 'proceed') {
      const reviewed = await step(
        'reviewer',
        `${task}\n\nPlan:\n${plan}\n\nChanged files:\n${list(files)}\n\nTest report:\n${tested.handoff.output}`,
        (_ledger, output) => {
          const verdict = parseVerdict(output);
          if (!verdict) return ['request_changes', 'reviewer verdict was not valid JSON'];
          return verdict.verdict === 'approve'
            ? ['approve']
            : ['request_changes', verdict.findings.join('\n') || 'reviewer requested changes'];
        },
      );
      if (reviewed.handoff.decision === 'halt') return finish('failed', reviewed.reason);
      if (reviewed.handoff.decision === 'approve') {
        const changeFiles = options.workspace.changes();
        const change: ProposedChange = {
          branch: config.branch,
          message: config.commitMessage,
          files: changeFiles,
          hash: '',
        };
        change.hash = hashChange(change);
        return finish('awaiting-approval', undefined, change);
      }
      why = reviewed.reason ?? 'reviewer requested changes';
    }

    if (reworkRounds >= config.maxReworkRounds) {
      return finish('halted', `rework limit reached (${config.maxReworkRounds}): ${why}`);
    }
    reworkRounds += 1;
    feedback = why;
  }
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
