/**
 * Trajectory evals for the four agents, graded with Escapement's harness.
 *   tsx evals/run.ts            run the suite and print the scores
 *   tsx evals/run.ts --gate     compare with evals/baseline.json, exit 1 on a regression (CI)
 *   tsx evals/run.ts --record   write evals/baseline.json (release branches only, by Escapement's rule)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger, FakeLlm } from '@adl/shared';
import { gate, renderMarkdown, renderText, runSuite, toBaseline, type Baseline } from 'escapement';
import { loadRoleAgents } from '../src/agents.js';
import { buildEvalSuite } from '../src/eval-cases.js';
import { LlmModelProvider } from '../src/provider.js';
import { runWorkflow } from '../src/workflow.js';
import { markerTestRunner, Workspace } from '../src/workspace.js';

const piece = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(piece, 'evals', 'baseline.json');
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(piece, rel), 'utf8')) as T;

const agents = loadRoleAgents(join(piece, 'agents'));
const provider = new LlmModelProvider(
  new FakeLlm(readJson<unknown[]>('fixtures/replies-clean.json').map((r) => JSON.stringify(r))),
);
const record = await runWorkflow({
  runId: 'eval-clean',
  task: 'Make greet() fall back to "world" when the name is empty',
  agents,
  workspace: Workspace.fromFiles(readJson('fixtures/repo.json')),
  runTests: markerTestRunner,
  providerFor: () => provider,
  audit: new AuditLogger(join(tmpdir(), `maw-eval-${process.pid}.jsonl`)),
  branch: 'develop',
});

const result = await runSuite(buildEvalSuite(record, agents));
console.log(renderText(result));

const mode = process.argv[2];
if (mode === '--record') {
  writeFileSync(baselinePath, `${JSON.stringify(toBaseline(result), null, 2)}\n`);
  console.log(`baseline written to ${baselinePath}`);
} else if (mode === '--gate') {
  const verdict = gate(result, JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline);
  console.log(renderMarkdown(verdict));
  process.exitCode = verdict.ok ? 0 : 1;
}
