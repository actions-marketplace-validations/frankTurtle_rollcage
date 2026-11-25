import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PIECE_DIR } from './helpers.js';

interface Step {
  uses?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Action {
  inputs: Record<string, { default?: string }>;
  runs: { using: string; steps: Step[] };
}

const action = parse(readFileSync(join(PIECE_DIR, 'action.yml'), 'utf8')) as Action;
const runs = action.runs.steps.filter((s) => s.run).map((s) => s.run as string);

describe('composite action contract (used by piece 12)', () => {
  it('is a composite action', () => {
    expect(action.runs.using).toBe('composite');
  });

  it('has a path input defaulting to the whole workspace', () => {
    expect(action.inputs['path']?.default).toBe('.');
  });

  it('has a policy input that defaults to the bundled policies', () => {
    expect(action.inputs).toHaveProperty('policy');
    expect(action.inputs['policy']?.default).toBe('');
  });

  it('runs the check command, which exits non-zero on any violation', () => {
    const check = runs.find((r) => /bin\.ts check/.test(r));
    expect(check).toBeDefined();
    expect(check).not.toMatch(/--no-fail|\|\| true|continue-on-error/);
  });

  it('passes inputs through env vars, never interpolated into a script', () => {
    for (const run of runs) expect(run).not.toContain('${{');
  });

  it('pins every external action by full commit SHA', () => {
    const uses = action.runs.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  it('verifies the conftest download against a checksum', () => {
    expect(runs.some((r) => /sha256sum|shasum/.test(r))).toBe(true);
  });
});
