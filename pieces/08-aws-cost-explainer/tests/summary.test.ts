import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis.ts';
import { fixtureAnalysisInput } from '../src/fixture-data.ts';
import {
  allowedAmounts,
  amountsAreGrounded,
  deterministicSummary,
  explain,
} from '../src/summary.ts';
import { GOOD_REPLY, must } from './helpers.ts';

const analysis = analyze(fixtureAnalysisInput());

describe('AC-6 the model summary is used only when it validates and is grounded', () => {
  it('uses a valid reply', async () => {
    const llm = new FakeLlm([GOOD_REPLY]);
    const r = await explain(llm, analysis);
    expect(r.source).toBe('model');
    expect(r.summary.headline).toContain('$711');
  });

  it('rejects a reply that quotes a figure not in the facts, then falls back', async () => {
    const bad = JSON.stringify({
      headline: 'Spend rose $9,999 this week.',
      paragraphs: ['Something happened.'],
      assumptions: ['None.'],
    });
    const llm = new FakeLlm([bad, bad]);
    const r = await explain(llm, analysis);
    expect(r.source).toBe('fallback');
    expect(r.reason).toMatch(/dollar figure/);
    expect(r.summary).toEqual(deterministicSummary(analysis));
  });

  it('accepts figures with or without cents and thousands separators', () => {
    const allowed = allowedAmounts(analysis);
    expect(amountsAreGrounded('up $310 and $310.00 and $3,236', allowed)).toBe(true);
    expect(amountsAreGrounded('up $311', allowed)).toBe(false);
  });
});

describe('AC-7 invalid output retries once, then falls back', () => {
  it('retries once on invalid JSON', async () => {
    const llm = new FakeLlm(['not json', GOOD_REPLY]);
    const r = await explain(llm, analysis);
    expect(r.source).toBe('model');
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back after two bad replies and says why', async () => {
    const llm = new FakeLlm(['nope', '{"headline":1}']);
    const r = await explain(llm, analysis);
    expect(r).toMatchObject({ source: 'fallback' });
    expect(r.reason).toBeTruthy();
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back without a call when no model is configured', async () => {
    const r = await explain(undefined, analysis);
    expect(r).toMatchObject({ source: 'fallback', reason: 'no model configured' });
  });
});

describe('AC-8 the prompt carries only computed aggregates and asks for assumptions', () => {
  it('includes the facts and the rules', async () => {
    const llm = new FakeLlm([GOOD_REPLY]);
    await explain(llm, analysis);
    const call = must(llm.calls[0]);
    expect(call.prompt).toContain('Amazon OpenSearch Service');
    expect(call.prompt).toContain('"unexplainedUsd": 580');
    expect(call.system).toMatch(/assumption/i);
    expect(call.system).toMatch(/only the numbers/i);
  });
});

describe('deterministic summary', () => {
  it('names the unexplained total and the largest unexplained service', () => {
    const s = deterministicSummary(analysis);
    expect(s.headline).toContain('$711');
    expect(s.headline).toContain('$580');
    expect(s.paragraphs.join(' ')).toContain('Amazon OpenSearch Service');
    expect(s.assumptions.length).toBeGreaterThan(0);
  });

  it('says so when nothing is unexplained', () => {
    const input = fixtureAnalysisInput();
    input.config.expectedChanges = ['Amazon OpenSearch Service', 'EC2 - Other', 'AWS Lambda'];
    const s = deterministicSummary(analyze(input));
    expect(s.headline).toMatch(/no unexplained/i);
  });

  it('handles a week with a decrease and no anomalies', () => {
    const input = fixtureAnalysisInput();
    input.anomalies = [];
    input.services.current = input.services.previous.map((r) => ({ ...r, amount: r.amount - 1 }));
    const s = deterministicSummary(analyze(input));
    expect(s.headline).toMatch(/fell/);
  });
});
