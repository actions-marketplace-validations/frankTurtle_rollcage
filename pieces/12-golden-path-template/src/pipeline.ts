import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface RunResult {
  code: number;
  output: string;
}
export type Runner = (cmd: string, args: string[], cwd: string) => RunResult;

export type StepStatus = 'passed' | 'failed' | 'not run';
export interface StepResult {
  name: string;
  status: StepStatus;
  output: string;
}
export interface SkippedJob {
  job: string;
  uses: string;
}
export interface PipelineResult {
  steps: StepResult[];
  skipped: SkippedJob[];
  ok: boolean;
}
export interface PipelineOptions {
  /** Symlink this node_modules into the project instead of running `pnpm install`. */
  linkModules?: string;
  runner?: Runner;
}

/** The local steps, in the order the generated build-test workflow runs them. */
const SCRIPT_STEPS = ['lint', 'typecheck', 'test', 'build'] as const;
const LOCAL_WORKFLOW = './.github/workflows/build-test.yml';
const OUTPUT_LIMIT = 4000;

export const spawnRunner: Runner = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  const output = `${r.stdout}${r.stderr}${r.error?.message ?? ''}`;
  return { code: r.status ?? 1, output: output.slice(-OUTPUT_LIMIT) };
};

/** Jobs in ci.yml that call a reusable workflow other than build-test. They need GitHub. */
export function githubOnlyJobs(dir: string): SkippedJob[] {
  const ci = join(dir, '.github/workflows/ci.yml');
  if (!existsSync(ci)) return [];
  const jobs: SkippedJob[] = [];
  let inJobs = false;
  let job = '';
  for (const line of readFileSync(ci, 'utf8').split('\n')) {
    if (/^jobs:\s*$/.test(line)) inJobs = true;
    else if (inJobs) {
      job = /^ {2}([\w-]+):\s*$/.exec(line)?.[1] ?? job;
      const uses = /^ {4}uses:\s*(\S+)/.exec(line)?.[1];
      if (uses && uses !== LOCAL_WORKFLOW) jobs.push({ job, uses });
    }
  }
  return jobs;
}

function install(dir: string, options: PipelineOptions, runner: Runner): RunResult {
  if (!existsSync(join(dir, 'package.json'))) {
    return { code: 1, output: `${dir} has no package.json` };
  }
  if (options.linkModules === undefined) return runner('pnpm', ['install'], dir);
  const modules = resolve(options.linkModules);
  if (!existsSync(modules)) return { code: 1, output: `${modules} does not exist` };
  symlinkSync(modules, join(dir, 'node_modules'), 'dir');
  return { code: 0, output: `linked ${modules}` };
}

/**
 * Run the generated project's pipeline steps on this machine: install, lint, typecheck, test, build.
 * Stops at the first failure. Jobs that need GitHub are listed as skipped, not run.
 */
export function runPipeline(dir: string, options: PipelineOptions = {}): PipelineResult {
  const runner = options.runner ?? spawnRunner;
  const steps: StepResult[] = [];
  let failed = false;
  const record = (name: string, run: () => RunResult): void => {
    if (failed) {
      steps.push({ name, status: 'not run', output: '' });
      return;
    }
    const { code, output } = run();
    failed = code !== 0;
    steps.push({ name, status: failed ? 'failed' : 'passed', output });
  };
  record('install', () => install(dir, options, runner));
  for (const script of SCRIPT_STEPS) {
    record(script, () => runner('npm', ['run', '--silent', script], dir));
  }
  return { steps, skipped: githubOnlyJobs(dir), ok: !failed };
}
