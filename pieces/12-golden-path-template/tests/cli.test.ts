import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli, type Io } from '../src/cli.ts';
import { tempDir, writeFile } from './helpers.ts';

function run(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t) };
  const code = runCli(argv, io);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('cli (AC10)', () => {
  it('prints usage and exits 2 with no command', () => {
    const r = run([]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage:/);
  });

  it('exits 2 on an unknown command', () => {
    const r = run(['frobnicate']);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/unknown command/);
  });

  it('prints usage and exits 0 for --help', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Usage:/);
  });

  it('exits 2 when scaffold arguments are missing', () => {
    expect(run(['scaffold']).code).toBe(2);
    expect(run(['scaffold', 'x', '--name', 'a']).code).toBe(2);
  });

  it('exits 2 on an unknown flag', () => {
    expect(run(['scaffold', 'x', '--name', 'a', '--owner', 'b', '--bogus']).code).toBe(2);
  });

  it('scaffolds, prints the file count and the pin check, exit 0', () => {
    const target = join(tempDir(), 'svc');
    const r = run(['scaffold', target, '--name', 'svc', '--owner', 'example-org']);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Created \d+ files/);
    expect(r.out).toMatch(/Pin check: ok/);
    expect(existsSync(join(target, '.github/workflows/ci.yml'))).toBe(true);
  });

  it('exits 1 with a message for a non-empty directory', () => {
    const target = tempDir();
    writeFile(target, 'x', '1');
    const r = run(['scaffold', target, '--name', 'svc', '--owner', 'example-org']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not empty/);
  });

  it('exits 1 for an invalid name', () => {
    const r = run(['scaffold', join(tempDir(), 'x'), '--name', 'Bad', '--owner', 'o']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/name/);
  });

  it('check prints each directory and the percentage, exit 1 when any is off the path', () => {
    const good = join(tempDir(), 'good');
    run(['scaffold', good, '--name', 'svc', '--owner', 'example-org']);
    const bad = join(tempDir(), 'bad');
    mkdirSync(bad);
    const ok = run(['check', good]);
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/100% on the golden path \(1 of 1\)/);
    const mixed = run(['check', good, bad]);
    expect(mixed.code).toBe(1);
    expect(mixed.out).toMatch(/OFF/);
    expect(mixed.out).toMatch(/50% on the golden path \(1 of 2\)/);
  });

  it('check without directories exits 2', () => {
    expect(run(['check']).code).toBe(2);
  });

  it('pipeline without a directory exits 2', () => {
    expect(run(['pipeline']).code).toBe(2);
  });
});
