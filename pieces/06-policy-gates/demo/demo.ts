/**
 * Demo driver: runs the real CLI and real conftest on the committed fixtures.
 * Offline and deterministic: explanations come from recorded responses unless DEMO_LIVE=1.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { green, header, red, runStages } from '@adl/shared';
import { runCli, type CliDeps } from '../src/cli.ts';
import { createConftestRunner } from '../src/conftest.ts';
import { createLlm } from '../src/llm.ts';
import { LLM_FIXTURE_DIR } from '../src/paths.ts';
import { PLAN, prepare, WORKFLOW } from './work.ts';

const LEDGER = 'examples/ledger.json';
const DIFF_LINES = 30;

const deps: CliDeps = {
  env: process.env,
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  runner: createConftestRunner(),
  createLlm: (live) => createLlm(live, process.env, LLM_FIXTURE_DIR),
};

/** Print only the lines that carry the problem, so the "before" is short enough to read. */
function showLines(file: string, pattern: RegExp): void {
  console.log(`\n${file}`);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (pattern.test(line)) console.log(`  ${line.trim().slice(0, 100)}`);
  }
}

/** Run the gate. The demo fails only when the gate does not behave as the script says. */
async function gate(expected: 0 | 1, ...extra: string[]): Promise<void> {
  const code = await runCli(['check', PLAN, WORKFLOW, ...extra], deps);
  const ok = code === expected;
  console.log(`\nexit code: ${code}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) process.exitCode = 1;
}

function showDiff(before: string, after: string): void {
  // Labels replace the file names and timestamps that diff prints, so output is the same each run.
  const labels = ['--label', `${after} (before)`, '--label', `${after} (after)`];
  const result = spawnSync('diff', ['-u', ...labels, before, after], { encoding: 'utf8' });
  const lines = result.stdout.split('\n');
  console.log(lines.slice(0, DIFF_LINES).join('\n'));
  if (lines.length > DIFF_LINES) console.log(`... ${lines.length - DIFF_LINES} more lines`);
}

function before(): void {
  prepare('violating');
  header('BEFORE: a plan and a workflow with violations');
  showLines(PLAN, /"acl"|"encrypted"|"Action":|"policy"/);
  showLines(WORKFLOW, /uses:|AWS_|permissions/);
  console.log('\nNo permissions block. A tag instead of a SHA. Static keys. Public bucket.');
}

async function run(): Promise<void> {
  prepare('violating');
  header('RUN: the gate (conftest decides, the model explains)');
  console.log(red('Expected result: the gate fails.\n'));
  await gate(1, '--explain');
}

async function after(): Promise<void> {
  prepare('violating');
  for (const file of [PLAN, WORKFLOW]) copyFileSync(file, `${file}.before`);
  prepare('fixed');
  header('AFTER: apply the fix');
  for (const file of [PLAN, WORKFLOW]) showDiff(`${file}.before`, file);
  header('AFTER: run the gate again');
  console.log(green('Expected result: the gate passes.\n'));
  await gate(0);
}

async function metric(): Promise<void> {
  header('METRIC: caught before merge vs found after deploy');
  await runCli(['metric', '--ledger', LEDGER, '--label', 'Policy gates'], deps);
}

const stagesExit = await runStages({ before, run, after, metric }, process.argv[2]);
process.exitCode = process.exitCode || stagesExit;
