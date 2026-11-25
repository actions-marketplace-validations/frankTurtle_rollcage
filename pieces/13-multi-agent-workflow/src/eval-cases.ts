import {
  callsTools,
  contextWithinBudget,
  correctable,
  endsAs,
  err,
  fatal,
  neverCalls,
  ok,
  replaysExactly,
  toolCalls,
  toolSequence,
  withinSteps,
  ToolMatch,
  type EvalCase,
  type EvalSuite,
  type RunLedger,
  type ScriptedTurn,
  type ToolDefinition,
} from 'escapement';
import type { AgentDef } from './agents.js';
import type { Role } from './roles.js';
import { buildToolRegistry } from './tools.js';
import { modelTurns } from './replay.js';
import { makeAssembler, type RunRecord } from './workflow.js';
import { Workspace } from './workspace.js';

/** Tools no agent may ever call, whatever its frontmatter says. */
const NEVER = ['commit', 'git_commit', 'push', 'git_push', 'shell', 'bash'];

/** The model turns of one recorded ledger as an Escapement script. */
const scriptFor = (ledger: RunLedger): ScriptedTurn[] =>
  modelTurns(ledger).map((e) =>
    e.type === 'model.failed'
      ? { failWith: e.error }
      : {
          say: e.message.content,
          ...(e.message.toolCalls?.length
            ? { callTools: e.message.toolCalls.map((c) => ({ name: c.name, args: c.args })) }
            : {}),
          usage: e.usage,
          stopReason: e.stopReason,
        },
  );

/** Tools that answer with what the recorded run saw, so the eval needs no repository. */
function recordedTools(agent: AgentDef, results: ReturnType<typeof toolCalls>): ToolDefinition[] {
  const base = buildToolRegistry(agent, {
    workspace: Workspace.fromFiles({}),
    runTests: () => ({ passed: true, summary: '' }),
  });
  return base.list().map((tool) => {
    const queue = results.filter((r) => r.name === tool.name);
    let next = 0;
    return {
      ...tool,
      handler: async () => {
        const recorded = queue[next++];
        if (!recorded)
          return err(
            fatal(
              'eval.unexpected_tool_call',
              `${tool.name} was called more often than in the recording`,
            ),
          );
        return recorded.ok
          ? ok(recorded.content)
          : err(correctable(recorded.errorCode ?? 'tool.rejected', recorded.content));
      },
    };
  });
}

/**
 * One Escapement EvalCase per recorded agent run, graded on trajectory: how it ended, which tools in
 * which order, no commit or shell tool, step limit, context budget, and exact replay.
 */
export function buildEvalSuite(
  record: RunRecord,
  agents: Record<Role, AgentDef>,
  options: { maxSteps?: number } = {},
): EvalSuite {
  const cases: EvalCase[] = [];
  for (const h of record.handoffs) {
    const ledger = record.ledgers[h.ledgerKey];
    if (!ledger) continue;
    const agent = agents[h.agent];
    cases.push({
      id: h.ledgerKey,
      description: `${h.agent} trajectory from run ${record.runId}`,
      goal: ledger.goal,
      script: scriptFor(ledger),
      tools: recordedTools(agent, toolCalls(ledger)),
      assembler: makeAssembler(agent),
      critical: true,
      graders: [
        endsAs('completed'),
        callsTools(toolSequence(ledger), ToolMatch.Exact),
        neverCalls(...NEVER),
        withinSteps(options.maxSteps ?? ledger.usage.modelCalls),
        contextWithinBudget(),
        replaysExactly(),
      ],
    });
  }
  return {
    id: 'multi-agent-workflow',
    description: 'Agent trajectories from a recorded run',
    cases,
  };
}
