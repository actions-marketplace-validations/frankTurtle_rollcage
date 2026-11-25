import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { createConftestRunner } from '../src/conftest.js';
import { collector, EXAMPLES, POLICY_DIR } from './helpers.js';

const hasConftest = spawnSync('conftest', ['--version']).status === 0;

async function gate(...files: string[]) {
  const io = collector();
  const code = await runCli(['check', '--json', '--policy', POLICY_DIR, ...files], {
    env: {},
    out: (t) => io.out.push(t),
    err: (t) => io.err.push(t),
    runner: createConftestRunner(),
    createLlm: () => {
      throw new Error('the model is not used here');
    },
  });
  return { code, report: JSON.parse(io.text() || '{}'), stderr: io.err.join('\n') };
}

// These run the real conftest against the committed fixtures. CI installs conftest.
describe.skipIf(!hasConftest)('committed examples under real conftest', () => {
  it('the plan with violations fails and reports control IDs', async () => {
    const { code, report } = await gate(join(EXAMPLES, 'terraform/plan-violations.json'));
    expect(code).toBe(1);
    const ids = report.violations.map((v: { ruleId: string }) => v.ruleId).sort();
    expect(ids).toEqual(['PG001', 'PG002', 'PG002', 'PG003', 'PG003']);
    const pg1 = report.violations.find((v: { ruleId: string }) => v.ruleId === 'PG001');
    expect(pg1.controls).toEqual(['3.1.3', '3.1.22', '3.13.1']);
  });

  it('the fixed plan passes', async () => {
    const { code, report } = await gate(join(EXAMPLES, 'terraform/plan-fixed.json'));
    expect(code).toBe(0);
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
  });

  it('the workflow with violations fails PG004, PG005 and PG006', async () => {
    const { code, report } = await gate(join(EXAMPLES, 'workflows/deploy-violations.yml'));
    expect(code).toBe(1);
    const ids = new Set(report.violations.map((v: { ruleId: string }) => v.ruleId));
    expect(ids).toEqual(new Set(['PG004', 'PG005', 'PG006']));
  });

  it('the fixed workflow passes', async () => {
    const { code } = await gate(join(EXAMPLES, 'workflows/deploy-fixed.yml'));
    expect(code).toBe(0);
  });

  it('testing a directory finds the violations in both file types', async () => {
    const { code, report } = await gate(EXAMPLES);
    expect(code).toBe(1);
    expect(report.violations.length).toBe(5 + 4);
  });

  it('exits 2 for a path that does not exist', async () => {
    const { code, stderr } = await gate(join(EXAMPLES, 'missing.json'));
    expect(code).toBe(2);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
