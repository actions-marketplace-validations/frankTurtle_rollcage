import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { parseBundleFiles } from '../src/bundle.js';
import { draftPostmortem } from '../src/draft.js';
import { Redactor } from '../src/redact.js';
import { PLANTED, sampleBundleFiles } from '../src/sample-bundle.js';
import { INCIDENT, goodReply } from './helpers.js';

const bundle = parseBundleFiles(sampleBundleFiles());

function payloads(llm: FakeLlm): string[] {
  return llm.calls.map((c) => `${c.system ?? ''}\n${c.prompt}`);
}

describe('AC-6 model draft', () => {
  it('renders summary, impact, timeline, hypotheses and blank owners', async () => {
    const llm = new FakeLlm([goodReply]);
    const result = await draftPostmortem(bundle, llm);
    expect(result.source).toBe('model');
    expect(llm.calls).toHaveLength(1);
    const md = result.markdown;
    expect(md).toContain('# Postmortem draft: INC-204');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Impact');
    expect(md).toContain('## Timeline');
    expect(md).toMatch(/## Contributing factors \(hypotheses\)/);
    expect(md).toMatch(/\[hypothesis\] The deploy may have changed/);
    expect(md).toMatch(/\| Action \| Owner \|/);
    expect(md).toMatch(/\| Add a pool saturation alert\. \| {2}\|/);
    expect(md).not.toContain('alice-smith');
    expect(md).toContain('## Redaction report');
  });

  it('cites event times from the deterministic timeline, in UTC', async () => {
    const result = await draftPostmortem(bundle, new FakeLlm([goodReply]));
    expect(result.timeline[0]?.at).toMatch(/Z$/);
    expect(result.markdown).toContain(`${result.timeline[0]?.at}`);
  });
});

describe('AC-7 invalid output', () => {
  const cases: Record<string, (r: { prompt: string }) => string> = {
    'bad json': () => 'not json at all',
    'unknown event id': (r) =>
      goodReply({ prompt: r.prompt }).replaceAll(/"E01"/g, '"E99"').replaceAll(/"E02"/g, '"E98"'),
    'factor stated as confirmed': (r) =>
      goodReply({ prompt: r.prompt }).replace('hypothesis', 'confirmed'),
    'missing section': () => JSON.stringify({ summary: 'only this' }),
  };

  for (const [name, bad] of Object.entries(cases)) {
    it(`retries once then falls back: ${name}`, async () => {
      const llm = new FakeLlm([bad, bad]);
      const result = await draftPostmortem(bundle, llm);
      expect(llm.calls).toHaveLength(2);
      expect(result.source).toBe('fallback');
      expect(result.reason).toBeTruthy();
      expect(result.markdown).toContain('generated without a model');
      expect(result.markdown).toContain(result.reason as string);
    });
  }

  it('accepts a valid retry after one bad reply', async () => {
    const llm = new FakeLlm(['oops', goodReply]);
    const result = await draftPostmortem(bundle, llm);
    expect(result.source).toBe('model');
    expect(llm.calls).toHaveLength(2);
  });

  it('falls back when the model call throws', async () => {
    const llm = new FakeLlm([new Error('503'), new Error('503')]);
    const result = await draftPostmortem(bundle, llm);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBe('503');
  });

  it('fallback lists the whole timeline, flags deploys before onset as hypotheses, leaves owners blank', async () => {
    const result = await draftPostmortem(bundle, new FakeLlm([new Error('x'), new Error('x')]));
    const md = result.markdown;
    expect(md).toContain('Impact has not been assessed');
    expect(md).toMatch(/\[hypothesis\] A deploy .* before the incident opened/);
    expect(md).toMatch(/\| Owner \|/);
    for (const e of result.timeline) expect(md).toContain(e.id);
  });

  it('fallback with no deploy before onset says no hypothesis could be drawn', async () => {
    const quiet = parseBundleFiles({
      ...sampleBundleFiles(),
      'deploys.json': '[]',
      'incident.json': JSON.stringify(INCIDENT),
    });
    const result = await draftPostmortem(quiet, new FakeLlm([new Error('x'), new Error('x')]));
    expect(result.markdown).toContain('No deploy shortly before onset');
  });
});

describe('AC-5 zero planted values reach the model', () => {
  it('holds for every payload, including the retry, and for the output', async () => {
    const llm = new FakeLlm(['oops', goodReply]);
    const result = await draftPostmortem(bundle, llm);
    const all = [...payloads(llm), result.markdown];
    for (const text of all) {
      for (const p of PLANTED) expect(text).not.toContain(p.value);
    }
    expect(payloads(llm)[0]).toContain('[EMAIL_1]');
  });

  it('holds when planted values sit in the incident title, deploy fields and notes', async () => {
    const files = sampleBundleFiles();
    const email = PLANTED.find((p) => p.type === 'email')?.value as string;
    const key = PLANTED.find((p) => p.type === 'aws-access-key')?.value as string;
    const ip = PLANTED.find((p) => p.type === 'ipv4')?.value as string;
    const nasty = parseBundleFiles({
      ...files,
      'incident.json': JSON.stringify({ ...INCIDENT, title: `Outage reported by ${email}` }),
      'deploys.json': JSON.stringify([
        { at: '2026-03-04T13:50:00Z', service: `svc-${key}`, version: `v1-${ip}`, deployer: email },
      ]),
      'notes.md': `- 14:10 UTC ${key} and ${ip} and ${email}`,
    });
    const llm = new FakeLlm([goodReply]);
    const result = await draftPostmortem(nasty, llm);
    for (const text of [...payloads(llm), result.markdown]) {
      for (const v of [email, key, ip]) expect(text).not.toContain(v);
    }
  });

  it('redacts a value the model invents in its output', async () => {
    const email = PLANTED.find((p) => p.type === 'email')?.value as string;
    const reply = (r: { prompt: string }) =>
      goodReply({ prompt: r.prompt }).replace(
        'Checkout was slow',
        `Mail ${email}: checkout was slow`,
      );
    const result = await draftPostmortem(bundle, new FakeLlm([reply]));
    expect(result.markdown).not.toContain(email);
  });

  it('stops before any call when the payload still holds a detectable value', async () => {
    class Leaky extends Redactor {
      override redact(text: string): string {
        return text;
      }
    }
    const llm = new FakeLlm([goodReply]);
    await expect(draftPostmortem(bundle, llm, { redactor: new Leaky() })).rejects.toThrow(
      /still contains/,
    );
    expect(llm.calls).toHaveLength(0);
  });
});

describe('AC-8 report in the draft', () => {
  it('lists counts and types, not values', async () => {
    const result = await draftPostmortem(bundle, new FakeLlm([goodReply]));
    expect(result.markdown).toMatch(/\| email \| \d+ \| \d+ \|/);
    expect(result.report.total).toBeGreaterThan(10);
  });
});

describe('large bundles', () => {
  it('keeps the start and end of the timeline and says how many events were omitted', async () => {
    const logs = Array.from({ length: 30 }, (_, i) => ({
      timestamp: Date.parse('2026-03-04T14:00:00Z') + i * 1000,
      message: `event ${i} ${'x'.repeat(i === 0 ? 600 : 1)}`,
    }));
    const big = parseBundleFiles({ ...sampleBundleFiles(), 'logs.json': JSON.stringify(logs) });
    const llm = new FakeLlm([goodReply]);
    await draftPostmortem(big, llm, { maxEvents: 10 });
    const prompt = llm.calls[0]?.prompt ?? '';
    expect(prompt).toMatch(/\(\d+ events omitted here\)/);
    expect(prompt.split('\n').filter((l) => /^E\d+ \|/.test(l))).toHaveLength(10);
    expect(prompt).toContain('...');
  });
});
