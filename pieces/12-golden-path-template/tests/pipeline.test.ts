import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { githubOnlyJobs, runPipeline, type Runner } from '../src/pipeline.ts';
import { scaffold } from '../src/scaffold.ts';
import { tempDir, writeFile } from './helpers.ts';

const MONOREPO_MODULES = join(dirname(fileURLToPath(import.meta.url)), '../../../node_modules');

function scaffolded(): string {
  const dir = join(tempDir(), 'svc');
  scaffold({ name: 'svc', owner: 'example-org', targetDir: dir });
  return dir;
}

describe('pipeline: unit (AC9)', () => {
  it('lists the jobs that need GitHub and not the local build job', () => {
    expect(githubOnlyJobs(scaffolded()).map((j) => j.job)).toEqual([
      'risk-gate',
      'secrets',
      'sbom',
      'policy',
      'provenance',
    ]);
  });

  it('returns no jobs when there is no ci.yml', () => {
    expect(githubOnlyJobs(tempDir())).toEqual([]);
  });

  it('runs the steps in order and stops at the first failure', () => {
    const calls: string[] = [];
    const runner: Runner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { code: args.includes('test') ? 1 : 0, output: 'boom' };
    };
    const result = runPipeline(scaffolded(), { linkModules: MONOREPO_MODULES, runner });
    expect(result.steps.map((s) => [s.name, s.status])).toEqual([
      ['install', 'passed'],
      ['lint', 'passed'],
      ['typecheck', 'passed'],
      ['test', 'failed'],
      ['build', 'not run'],
    ]);
    expect(result.ok).toBe(false);
    expect(calls).toEqual([
      'npm run --silent lint',
      'npm run --silent typecheck',
      'npm run --silent test',
    ]);
  });

  it('runs a real install through the runner when no modules are linked', () => {
    const calls: string[] = [];
    const runner: Runner = (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      return { code: 0, output: '' };
    };
    const result = runPipeline(scaffolded(), { runner });
    expect(result.ok).toBe(true);
    expect(calls[0]).toBe('pnpm install');
  });

  it('fails the install step when the linked modules path is missing', () => {
    const result = runPipeline(scaffolded(), {
      linkModules: join(tempDir(), 'missing'),
      runner: () => ({ code: 0, output: '' }),
    });
    expect(result.steps[0]).toMatchObject({ name: 'install', status: 'failed' });
    expect(result.ok).toBe(false);
  });

  it('fails when the directory is not a project', () => {
    const dir = tempDir();
    writeFile(dir, 'x', '1');
    const result = runPipeline(dir, { runner: () => ({ code: 0, output: '' }) });
    expect(result.ok).toBe(false);
  });
});

describe('pipeline: a scaffolded project runs locally (AC9)', () => {
  it('install (linked), lint, typecheck, test and build all pass', () => {
    const result = runPipeline(scaffolded(), { linkModules: MONOREPO_MODULES });
    const failed = result.steps.filter((s) => s.status === 'failed');
    expect(failed.map((s) => `${s.name}\n${s.output}`)).toEqual([]);
    expect(result.steps.map((s) => s.name)).toEqual([
      'install',
      'lint',
      'typecheck',
      'test',
      'build',
    ]);
    expect(result.ok).toBe(true);
    expect(result.skipped.length).toBe(5);
  });
});
