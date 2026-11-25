import {
  callsTools,
  caseFromLedger,
  contextWithinBudget,
  endsAs,
  neverCalls,
  replaysExactly,
  toolSequence,
  withinSteps,
  ToolMatch,
  type EvalCase,
  type EvalSuite,
} from 'escapement';
import type { AgentDef } from './agents.js';
import type { Role } from './roles.js';
import { buildToolRegistry } from './tools.js';
import { makeAssembler, type RunRecord } from './workflow.js';
import { Workspace } from './workspace.js';

/** Tools no agent may ever call, whatever its frontmatter says. */
const NEVER = ['commit', 'git_commit', 'push', 'git_push', 'shell', 'bash'];

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
    const tools = buildToolRegistry(agent, {
      workspace: Workspace.fromFiles({}),
      runTests: () => ({ passed: true, summary: '' }),
    }).list();
    cases.push(
      caseFromLedger(
        ledger,
        [
          endsAs('completed'),
          callsTools(toolSequence(ledger), ToolMatch.Exact),
          neverCalls(...NEVER),
          withinSteps(options.maxSteps ?? ledger.usage.modelCalls),
          contextWithinBudget(),
          replaysExactly(),
        ],
        {
          id: h.ledgerKey,
          description: `${h.agent} trajectory from run ${record.runId}`,
          tools,
          assembler: makeAssembler(agent),
          critical: true,
        },
      ),
    );
  }
  return {
    id: 'multi-agent-workflow',
    description: 'Agent trajectories from a recorded run',
    cases,
  };
}
