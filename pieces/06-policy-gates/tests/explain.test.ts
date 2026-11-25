import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { buildExplainRequest, explainViolation } from '../src/explain.js';
import type { Violation } from '../src/types.js';

const violation: Violation = {
  ruleId: 'PG001',
  message: 'aws_s3_bucket.assets has the public ACL "public-read"',
  file: 'plan.json',
  controls: ['3.1.3'],
  title: 'No public S3 buckets',
  remediation: 'Use a private ACL.',
};

const good = JSON.stringify({
  explanation: 'The bucket ACL lets anyone on the internet read its objects.',
  assumptions: ['The bucket holds non-public data.'],
});

describe('explainViolation', () => {
  it('returns the model explanation with its assumptions when the JSON validates', async () => {
    const llm = new FakeLlm([good]);
    const result = await explainViolation(llm, violation);
    expect(result).toMatchObject({
      source: 'model',
      text: expect.stringContaining('anyone on the internet'),
      assumptions: ['The bucket holds non-public data.'],
    });
  });

  it('retries once on invalid output and then uses the model answer', async () => {
    const llm = new FakeLlm(['not json', good]);
    const result = await explainViolation(llm, violation);
    expect(result.source).toBe('model');
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back to the mapping remediation after two invalid answers, and says why', async () => {
    const llm = new FakeLlm(['nope', JSON.stringify({ explanation: '' })]);
    const result = await explainViolation(llm, violation);
    expect(result.source).toBe('fallback');
    expect(result.text).toBe('Use a private ACL.');
    expect(result.reason).toMatch(/schema validation failed/);
  });

  it('falls back when the call itself fails', async () => {
    const result = await explainViolation(
      new FakeLlm([new Error('offline'), new Error('offline')]),
      violation,
    );
    expect(result).toMatchObject({ source: 'fallback', reason: 'offline' });
  });

  it('requires at least one stated assumption', async () => {
    const noAssumptions = JSON.stringify({ explanation: 'x', assumptions: [] });
    const result = await explainViolation(new FakeLlm([noAssumptions, noAssumptions]), violation);
    expect(result.source).toBe('fallback');
  });
});

describe('buildExplainRequest', () => {
  it('sends the rule, message, file and controls and nothing else', () => {
    const request = buildExplainRequest(violation);
    expect(request.prompt).toContain('PG001');
    expect(request.prompt).toContain('aws_s3_bucket.assets');
    expect(request.prompt).toContain('plan.json');
    expect(request.prompt).toContain('3.1.3');
    expect(request.system).toMatch(/do not decide/i);
    expect(request.system).toMatch(/assumption/i);
  });

  it('does not pin a model id', () => {
    expect(buildExplainRequest(violation).model).toBeUndefined();
  });
});
