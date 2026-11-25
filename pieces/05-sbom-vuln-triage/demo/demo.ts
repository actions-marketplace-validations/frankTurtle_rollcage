/**
 * Demo driver: runs the real CLI on committed fixtures. Syft and Grype do not run, no vulnerability
 * database is downloaded, and the model answers come from recorded responses. KEV and EPSS are
 * synthetic snapshots.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { header, red, runStages } from '@adl/shared';
import { runCli } from '../src/cli.ts';
import { parseGrype } from '../src/grype.ts';
import { parseSbom } from '../src/sbom.ts';
import { APP_ARGS, fixtures } from './args.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
const json = (name: string): unknown => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));

async function cli(args: string[]): Promise<number> {
  return runCli(args, {
    env: process.env,
    out: (t) => console.log(t),
    err: (t) => console.error(t),
  });
}

function before(): void {
  header('BEFORE: the raw scan');
  const apps = [
    ['shop-api (Node)', 'node-app', 'grype-node-app.json'],
    ['report-worker (Python)', 'python-app', 'grype-python-app.json'],
  ] as const;
  for (const [label, sbom, grype] of apps) {
    const packages = parseSbom(json(`${sbom}.cdx.json`)).length;
    const findings = parseGrype(json(grype), label);
    console.log(`\n${label}: ${packages} packages in the SBOM, ${findings.length} findings`);
    for (const f of findings) {
      console.log(`  ${f.severity.padEnd(9)} ${f.id.padEnd(21)} ${f.package} ${f.version}`);
    }
  }
  console.log('\nScanner order. Nothing says what to fix first.');
}

async function run(): Promise<void> {
  header('RUN: prioritized, with code evidence');
  await cli(['report', ...APP_ARGS, '--show', 'table,notes', '--out', out]);
}

async function after(): Promise<void> {
  header('AFTER: the leadership note');
  await cli(['report', ...APP_ARGS, '--show', 'leadership']);
  header('AFTER: what changed between releases (shop-api 1.0.0 to 1.1.0)');
  await cli([
    'diff',
    ...['--from', join(fixtures, 'node-app-1.0.0.cdx.json')],
    ...['--to', join(fixtures, 'node-app.cdx.json')],
  ]);
  header('AFTER: the CI gate');
  const code = await cli(['gate', ...APP_ARGS, '--fail-on', 'critical']);
  console.log(code === 0 ? 'Exit code 0' : red(`Exit code ${code}: the build stops.`));
}

async function metric(): Promise<void> {
  header('METRIC: three numbers');
  await cli(['metrics', ...APP_ARGS]);
  console.log('\nHistory and triage minutes are synthetic or assumed. Say so.');
}

process.exitCode = await runStages({ before, run, after, metric }, process.argv[2] ?? 'all');
