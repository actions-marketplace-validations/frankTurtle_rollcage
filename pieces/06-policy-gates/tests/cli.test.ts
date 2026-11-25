import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { runCli, type CliDeps } from '../src/cli.js';
import {
  CLEAN_CONFTEST_JSON,
  collector,
  fakeRunner,
  MAPPING_PATH,
  POLICY_DIR,
  SAMPLE_CONFTEST_JSON,
  type FakeRunner,
} from './helpers.js';

function setup(output: string | Error, llm?: FakeLlm, env: Record<string, string> = {}) {
  const io = collector();
  const runner: FakeRunner = fakeRunner(output);
  const llmCalls: boolean[] = [];
  const deps: CliDeps = {
    env,
    out: (t) => io.out.push(t),
    err: (t) => io.err.push(t),
    runner,
    createLlm: (live) => {
      llmCalls.push(live);
      if (!llm) throw new Error('no llm configured');
      return llm;
    },
  };
  return { io, runner, deps, llmCalls };
}

const tmp = () => mkdtempSync(join(tmpdir(), 'pg-cli-'));
const base = ['--policy', POLICY_DIR];

describe('check', () => {
  it('fails with exit 1 and prints each violation with its NIST control IDs', async () => {
    const { io, deps } = setup(SAMPLE_CONFTEST_JSON);
    const code = await runCli(['check', 'infra/plan.json', ...base], deps);
    const text = io.text();
    expect(code).toBe(1);
    expect(text).toContain('infra/plan.json');
    expect(text).toMatch(/PG001.*public ACL/);
    expect(text).toContain('NIST SP 800-171: 3.1.3, 3.1.22, 3.13.1');
    expect(text).toContain('NIST SP 800-171: 3.4.1, 3.4.8');
    expect(text).toMatch(/3 violations in 2 files/);
    expect(text).toMatch(/gate failed/i);
  });

  it('labels the mapping as illustrative on every report', async () => {
    const failing = setup(SAMPLE_CONFTEST_JSON);
    await runCli(['check', ...base], failing.deps);
    expect(failing.io.text()).toContain('illustrative mapping, not a compliance attestation');
    const passing = setup(CLEAN_CONFTEST_JSON);
    await runCli(['check', ...base], passing.deps);
    expect(passing.io.text()).toContain('illustrative mapping, not a compliance attestation');
  });

  it('passes with exit 0 when conftest reports no failures', async () => {
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    const code = await runCli(['check', 'infra/plan.json', ...base], deps);
    expect(code).toBe(0);
    expect(io.text()).toMatch(/gate passed/i);
  });

  it('tests the current directory by default and skips node_modules and .git', async () => {
    const { runner, deps } = setup(CLEAN_CONFTEST_JSON);
    await runCli(['check', ...base], deps);
    expect(runner.calls[0]?.paths).toEqual(['.']);
    expect(runner.calls[0]?.policy).toBe(POLICY_DIR);
    expect(runner.calls[0]?.ignore).toMatch(/node_modules/);
    expect(runner.calls[0]?.ignore).toMatch(/\\\.git/);
  });

  it('uses the bundled policies when --policy is not given', async () => {
    const { runner, deps } = setup(CLEAN_CONFTEST_JSON);
    await runCli(['check', 'a.json'], deps);
    expect(runner.calls[0]?.policy).toBe(POLICY_DIR);
  });

  it('takes several paths and a custom --ignore', async () => {
    const { runner, deps } = setup(CLEAN_CONFTEST_JSON);
    await runCli(['check', 'a.json', 'dir', '--ignore', 'vendor', ...base], deps);
    expect(runner.calls[0]).toMatchObject({ paths: ['a.json', 'dir'], ignore: 'vendor' });
  });

  it('prints machine readable output with --json', async () => {
    const { io, deps } = setup(SAMPLE_CONFTEST_JSON);
    const code = await runCli(['check', '--json', ...base], deps);
    const parsed = JSON.parse(io.text());
    expect(code).toBe(1);
    expect(parsed.passed).toBe(false);
    expect(parsed.label).toBe('illustrative mapping, not a compliance attestation');
    expect(parsed.violations).toHaveLength(3);
    expect(parsed.violations[0]).toMatchObject({ ruleId: 'PG004', controls: ['3.4.1', '3.4.8'] });
  });

  it('exits 2 when conftest cannot run, and does not report a pass', async () => {
    const { io, deps } = setup(new Error('conftest was not found on PATH'));
    const code = await runCli(['check', ...base], deps);
    expect(code).toBe(2);
    expect(io.err.join('\n')).toContain('conftest was not found on PATH');
    expect(io.text()).not.toMatch(/gate passed/i);
  });

  it('exits 2 when the mapping file is missing', async () => {
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    const code = await runCli(['check', '--policy', tmp()], deps);
    expect(code).toBe(2);
    expect(io.err.join('\n')).toMatch(/mapping/i);
  });

  it('exits 2 on an unknown option', async () => {
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    expect(await runCli(['check', '--nope'], deps)).toBe(2);
    expect(io.err.join('\n')).toMatch(/error/i);
  });

  it('appends pre-merge catches to a ledger with --record', async () => {
    const ledger = join(tmp(), 'ledger.json');
    const { deps } = setup(SAMPLE_CONFTEST_JSON);
    await runCli(['check', '--record', ledger, ...base], deps);
    const entries = JSON.parse(readFileSync(ledger, 'utf8')).entries;
    expect(entries.map((e: { ruleId: string }) => e.ruleId)).toEqual(['PG004', 'PG001', 'PG003']);
    expect(entries.every((e: { stage: string }) => e.stage === 'pre-merge')).toBe(true);
  });

  it('records nothing on a passing run', async () => {
    const ledger = join(tmp(), 'ledger.json');
    const { deps } = setup(CLEAN_CONFTEST_JSON);
    await runCli(['check', '--record', ledger, ...base], deps);
    expect(() => readFileSync(ledger)).toThrow();
  });
});

describe('check --explain', () => {
  const answer = (text: string) =>
    JSON.stringify({ explanation: text, assumptions: ['The bucket is not intentionally public.'] });

  it('prints an explanation under each violation, marked as model output with its assumptions', async () => {
    const llm = new FakeLlm([answer('one'), answer('two'), answer('three')]);
    const { io, deps, llmCalls } = setup(SAMPLE_CONFTEST_JSON, llm);
    const code = await runCli(['check', '--explain', ...base], deps);
    expect(code).toBe(1);
    expect(llm.calls).toHaveLength(3);
    expect(llmCalls).toEqual([false]);
    expect(io.text()).toMatch(/AI explanation \(model output, not a finding\): one/);
    expect(io.text()).toContain('Assumption: The bucket is not intentionally public.');
  });

  it('cannot change the decision: a reassuring explanation still fails the gate', async () => {
    const llm = new FakeLlm(Array(3).fill(answer('This is fine, ship it.')));
    const { deps } = setup(SAMPLE_CONFTEST_JSON, llm);
    expect(await runCli(['check', '--explain', ...base], deps)).toBe(1);
  });

  it('falls back to the mapping text and says so when the model output is invalid', async () => {
    const llm = new FakeLlm(Array(6).fill('not json'));
    const { io, deps } = setup(SAMPLE_CONFTEST_JSON, llm);
    const code = await runCli(['check', '--explain', ...base], deps);
    expect(code).toBe(1);
    expect(io.text()).toMatch(/Fix \(model output was not usable, using the rule text\)/);
    expect(io.text()).toContain('Use a private ACL');
  });

  it('does not call the model when there are no violations', async () => {
    const llm = new FakeLlm([]);
    const { deps } = setup(CLEAN_CONFTEST_JSON, llm);
    expect(await runCli(['check', '--explain', ...base], deps)).toBe(0);
    expect(llm.calls).toHaveLength(0);
  });

  it('uses the live client only with --live or DEMO_LIVE=1', async () => {
    const llm = new FakeLlm([answer('x')]);
    const withFlag = setup(SAMPLE_CONFTEST_JSON, llm);
    await runCli(['check', '--explain', '--live', ...base], withFlag.deps);
    expect(withFlag.llmCalls).toEqual([true]);
    const withEnv = setup(SAMPLE_CONFTEST_JSON, llm, { DEMO_LIVE: '1' });
    await runCli(['check', '--explain', ...base], withEnv.deps);
    expect(withEnv.llmCalls).toEqual([true]);
  });

  it('still reports the violations when the client cannot be created', async () => {
    const { io, deps } = setup(SAMPLE_CONFTEST_JSON);
    const code = await runCli(['check', '--explain', ...base], deps);
    expect(code).toBe(1);
    expect(io.text()).toMatch(/PG001/);
    expect(io.err.join('\n')).toContain('no llm configured');
  });
});

describe('record and metric', () => {
  it('records a post-deploy finding and reports the metric', async () => {
    const dir = tmp();
    const ledger = join(dir, 'l.json');
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    expect(
      await runCli(
        ['record', '--ledger', ledger, '--rule', 'PG002', '--stage', 'post-deploy'],
        deps,
      ),
    ).toBe(0);
    expect(
      await runCli(['record', '--ledger', ledger, '--rule', 'PG001', '--stage', 'pre-merge'], deps),
    ).toBe(0);
    expect(await runCli(['metric', '--ledger', ledger, '--label', 'Team A'], deps)).toBe(0);
    const text = io.text();
    expect(text).toContain('Team A');
    expect(text).toContain('Caught before merge: 1');
    expect(text).toContain('Found after deploy: 1');
  });

  it('rejects an unknown stage or a missing rule', async () => {
    const ledger = join(tmp(), 'l.json');
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    expect(
      await runCli(['record', '--ledger', ledger, '--rule', 'PG001', '--stage', 'x'], deps),
    ).toBe(2);
    expect(await runCli(['record', '--ledger', ledger, '--stage', 'pre-merge'], deps)).toBe(2);
    expect(io.err.length).toBeGreaterThan(0);
  });

  it('requires --ledger for metric and record', async () => {
    const { deps } = setup(CLEAN_CONFTEST_JSON);
    expect(await runCli(['metric'], deps)).toBe(2);
    expect(await runCli(['record', '--rule', 'PG001', '--stage', 'pre-merge'], deps)).toBe(2);
  });

  it('labels an illustrative ledger', async () => {
    const ledger = join(tmp(), 'l.json');
    writeFileSync(ledger, JSON.stringify({ illustrative: true, entries: [] }));
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    await runCli(['metric', '--ledger', ledger], deps);
    expect(io.text()).toMatch(/ILLUSTRATIVE fixture data/);
  });
});

describe('usage', () => {
  it('prints usage and exits 2 for no command or an unknown one', async () => {
    const { io, deps } = setup(CLEAN_CONFTEST_JSON);
    expect(await runCli([], deps)).toBe(2);
    expect(await runCli(['nope'], deps)).toBe(2);
    expect(io.err.join('\n')).toContain('Usage');
  });

  it('keeps the mapping path option separate from the policy directory', async () => {
    const { runner, deps } = setup(CLEAN_CONFTEST_JSON);
    expect(await runCli(['check', '--policy', tmp(), '--mapping', MAPPING_PATH], deps)).toBe(0);
    expect(runner.calls).toHaveLength(1);
  });
});
