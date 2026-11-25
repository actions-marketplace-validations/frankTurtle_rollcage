import { FakeLlm, UnavailableLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import type { Classification } from '../src/classify.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { fallbackSummary, summarize } from '../src/summarize.ts';
import type { SummaryInput } from '../src/summarize.ts';

const classification = (category: Classification['category']): Classification => ({
  category,
  confidence: 'high',
  ruleId: 'x',
  evidence: ['matched: ENOSPC: no space left on device'],
  note: 'Heuristic reading of the log and run history, not a confirmed root cause.',
});

const input = (category: Classification['category'] = 'infrastructure'): SummaryInput => ({
  classification: classification(category),
  signature: 'ENOSPC: no space left on device',
  tests: [],
  excerpt: ['ENOSPC: no space left on device, write', 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE'],
  config: DEFAULT_CONFIG,
});

const good = JSON.stringify({
  summary: 'The build ran out of disk space while installing packages.',
  next_step: 'Free disk space on the runner or use a larger runner, then re-run.',
  assumptions: ['Assumed the disk was full because of the Docker layer cache.'],
});

describe('AC-7 summary through the structured helper', () => {
  it('uses a valid model reply', async () => {
    const llm = new FakeLlm([good]);
    const out = await summarize(llm, input());
    expect(out).toMatchObject({
      source: 'model',
      summary: 'The build ran out of disk space while installing packages.',
      assumptions: ['Assumed the disk was full because of the Docker layer cache.'],
    });
    expect(out.nextStep).toContain('Free disk space');
  });

  it('puts the decided category in the prompt, forbids changing it, and redacts secrets', async () => {
    const llm = new FakeLlm([good]);
    await summarize(llm, input());
    const call = llm.calls[0];
    expect(call?.system).toMatch(/do not change the category/i);
    expect(call?.system).toMatch(/never state a root cause as confirmed/i);
    expect(call?.prompt).toContain('"category": "infrastructure"');
    expect(call?.prompt).toContain('no space left on device');
    expect(call?.prompt).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(call?.model).toBeUndefined();
  });

  it('retries once on invalid output, then uses the second reply', async () => {
    const llm = new FakeLlm(['not json', good]);
    const out = await summarize(llm, input());
    expect(out.source).toBe('model');
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back to the deterministic text when output stays invalid, and says why', async () => {
    const llm = new FakeLlm(['nope', JSON.stringify({ summary: 'x' })]);
    const out = await summarize(llm, input('dependency'));
    expect(out.source).toBe('fallback');
    expect(out.reason).toMatch(/schema validation failed/);
    expect(out.summary).toBe(fallbackSummary(input('dependency')).summary);
    expect(llm.calls).toHaveLength(2);
  });

  it('requires at least one assumption in the reply', async () => {
    const noAssumptions = JSON.stringify({ summary: 's', next_step: 'n', assumptions: [] });
    const out = await summarize(new FakeLlm([noAssumptions, noAssumptions]), input());
    expect(out.source).toBe('fallback');
  });

  it('falls back when the model is unavailable', async () => {
    const out = await summarize(new UnavailableLlm('LLM disabled (--llm none)'), input('flaky'));
    expect(out).toMatchObject({ source: 'fallback', reason: 'LLM disabled (--llm none)' });
  });

  it('ignores a category in the reply: the result has no category field', async () => {
    const sneaky = JSON.stringify({
      summary: 's',
      next_step: 'n',
      assumptions: ['a'],
      category: 'regression',
    });
    const out = await summarize(new FakeLlm([sneaky]), input('infrastructure'));
    expect(out).not.toHaveProperty('category');
    expect(out.source).toBe('model');
  });

  it('has fallback text for every category, with assumptions that say it is a heuristic', () => {
    for (const c of ['regression', 'flaky', 'infrastructure', 'dependency', 'unknown'] as const) {
      const f = fallbackSummary(input(c));
      expect(f.summary.length).toBeGreaterThan(20);
      expect(f.nextStep.length).toBeGreaterThan(20);
      expect(f.assumptions.join(' ')).toMatch(/heuristic/i);
    }
  });

  it('names the failing tests in the fallback for a flaky or regression result', () => {
    const f = fallbackSummary({ ...input('flaky'), tests: ['tests/a.test.ts > x'] });
    expect(f.summary).toContain('tests/a.test.ts > x');
  });
});
