/** Demo driver: runs the real CLI on FIXTURE runs and logs, with recorded model replies. */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, isLiveMode, runStages } from '@adl/shared';
import { runCli } from '../src/cli.ts';
import { maintainerCommands } from '../src/quarantine.ts';
import { parseRuns } from '../src/runs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');
const out = join(here, 'out');
const LABEL = 'fixture data, made up for this demo';

const f = (name: string): string => join(fixtures, name);

async function cli(args: string[]): Promise<string[]> {
  const printed: string[] = [];
  const code = await runCli(args, {
    env: process.env,
    out: (t) => printed.push(t),
    err: (t) => console.error(t),
  });
  if (code !== 0) process.exitCode = code;
  return printed;
}

const triageArgs = [
  ...['triage', '--runs', f('runs.json'), '--history', f('history.json')],
  ...['--quarantine', f('quarantine.json'), '--out', out],
  ...(isLiveMode(process.env)
    ? ['--llm', 'live']
    : ['--llm', 'replay', '--llm-fixtures', join(here, 'llm-fixtures')]),
];

function before(): void {
  header(`BEFORE: the Actions tab today (${LABEL})`);
  const runs = parseRuns(readFileSync(f('runs.json'), 'utf8'));
  const recent = runs.filter((r) => r.conclusion === 'failure' && r.completedAt >= '2026-03-16');
  for (const r of recent) {
    console.log(
      `  #${r.id}  ${r.workflow}  ${r.branch.padEnd(14)} failed  ${r.completedAt.slice(0, 16)}`,
    );
  }
  console.log(`\n${recent.length} red builds. The tab does not say why.`);
  console.log('Each one costs someone a log read, or a re-run and a hope.');
}

async function run(): Promise<void> {
  header(`RUN: classify every failed run (${LABEL})`);
  const printed = await cli(triageArgs);
  console.log(printed[0]);
}

async function after(): Promise<void> {
  if (!existsSync(join(out, 'quarantine.patch'))) await cli(triageArgs);
  header('AFTER: quarantine proposal for one flaky test');
  console.log(readFileSync(join(out, 'quarantine-pr-body.md'), 'utf8'));
  console.log('Patch:\n');
  console.log(readFileSync(join(out, 'quarantine.patch'), 'utf8'));
  const { proposal } = JSON.parse(readFileSync(join(out, 'triage.json'), 'utf8')) as {
    proposal: { path: string };
  };
  console.log(
    maintainerCommands(
      'demo/out/quarantine.patch',
      'demo/out/quarantine-pr-body.md',
      proposal.path,
    ),
  );
}

async function metric(): Promise<void> {
  header('METRIC: before and after the quarantine step');
  const args = [
    'metrics',
    '--runs',
    f('runs.json'),
    '--since',
    '2026-02-02',
    '--until',
    '2026-03-30',
  ];
  console.log((await cli([...args, '--compare-at', '2026-03-02', '--label', LABEL])).join('\n'));
}

const requested = process.argv[2] ?? 'all';
if (requested === 'all' || requested === 'run') rmSync(out, { recursive: true, force: true });
process.exitCode = await runStages({ before, run, after, metric }, requested);
