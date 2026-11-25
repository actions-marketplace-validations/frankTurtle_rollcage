/** Demo driver: runs the real CLI against directories under demo/out. No network, no GitHub. */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli.ts';
import { walk } from '../src/scaffold.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
// Paths are shown relative to the working directory so they stay short on screen.
const shown = (p: string) => relative(process.cwd(), p);
const service = shown(join(out, 'payments-api'));
const empty = shown(join(out, 'empty-repo'));
const modules = join(here, '../../../node_modules');

const tty = process.stdout.isTTY;
const bold = (t: string) => (tty ? `\u001b[1m${t}\u001b[0m` : t);
const header = (t: string) => console.log(`\n${bold(`== ${t} ==`)}`);
const io = { out: (t: string) => console.log(t), err: (t: string) => console.error(t) };

function cli(args: string[]): number {
  return runCli(args, io);
}

function before(): void {
  header('BEFORE: a new repo started by hand');
  rmSync(empty, { recursive: true, force: true });
  mkdirSync(empty, { recursive: true });
  cli(['check', empty]);
  console.log('No CI, no review rules, no secret scan. Every team builds these again.');
}

function run(): void {
  header('RUN: scaffold payments-api for example-org');
  rmSync(service, { recursive: true, force: true });
  cli(['scaffold', service, '--name', 'payments-api', '--owner', 'example-org']);
  console.log('\nFiles:');
  for (const f of walk(service).sort()) console.log(`  ${f}`);
  console.log('\nAgain, into the same directory:');
  const code = cli(['scaffold', service, '--name', 'payments-api', '--owner', 'example-org']);
  console.log(`(exit ${code}: nothing was overwritten)`);
  console.log('\nCheck:');
  cli(['check', service]);
}

function after(): void {
  header('AFTER: the generated pipeline runs on this machine');
  if (!existsSync(service)) {
    console.log('Run the "run" stage first: pnpm --filter @adl/golden-path-template demo run');
    process.exitCode = 1;
    return;
  }
  rmSync(join(service, 'node_modules'), { force: true });
  rmSync(join(service, 'dist'), { recursive: true, force: true });
  if (cli(['pipeline', service, '--link-modules', modules]) !== 0) process.exitCode = 1;
}

function metric(): void {
  header('METRIC: share of repos on the golden path (two demo directories)');
  if (!existsSync(service) || !existsSync(empty)) {
    console.log('Run the "before" and "run" stages first.');
    process.exitCode = 1;
    return;
  }
  cli(['check', service, empty]);
  console.log(
    'Time to first deploy comes from GitHub. See the README for the two gh api commands.',
  );
}

const stage = process.argv[2] ?? 'all';
const stages: Record<string, () => void> = { before, run, after, metric };
if (stage === 'all') {
  rmSync(out, { recursive: true, force: true });
  for (const fn of [before, run, after, metric]) fn();
} else if (stages[stage]) {
  stages[stage]();
} else {
  console.error(`unknown stage ${stage}; use all, before, run, after or metric`);
  process.exitCode = 2;
}
