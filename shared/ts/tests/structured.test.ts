import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeLlm, completeStructured, extractJson } from '../src/index.js';

const schema = z.object({ risk: z.enum(['low', 'high']) });
const fallback = () => ({ risk: 'high' as const });

describe('extractJson', () => {
  it('parses bare and fenced JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('text\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('```\n{"a":3}\n```')).toEqual({ a: 3 });
  });
});

describe('completeStructured', () => {
  it('returns the validated model output', async () => {
    const llm = new FakeLlm(['{"risk":"low"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r).toEqual({ value: { risk: 'low' }, source: 'model', attempts: 1 });
  });

  it('retries once on invalid output, then succeeds', async () => {
    const llm = new FakeLlm(['{"risk":"medium"}', '{"risk":"low"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.source).toBe('model');
    expect(r.attempts).toBe(2);
  });

  it('falls back after two invalid outputs and says why', async () => {
    const llm = new FakeLlm(['not json', '{"risk":"nope"}']);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.source).toBe('fallback');
    expect(r.value).toEqual({ risk: 'high' });
    expect(r.reason).toContain('schema validation failed');
  });

  it('falls back when the model is unavailable', async () => {
    const llm = new FakeLlm([new Error('unavailable'), new Error('unavailable')]);
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r).toMatchObject({ source: 'fallback', reason: 'unavailable' });
  });

  it('records a non-Error failure generically', async () => {
    const llm = { complete: () => Promise.reject('weird') };
    const r = await completeStructured(llm, { prompt: 'p' }, schema, fallback);
    expect(r.reason).toBe('call failed');
  });
});

describe('completeStructured with .transform', () => {
  const request = { prompt: 'p' };
  const attempt = (candidate: z.ZodTypeAny) => {
    const llm = new FakeLlm(['{"n":"1"}']);
    return completeStructured(llm, request, candidate, () => ({}));
  };

  it('rejects a top-level transform before calling the model', async () => {
    const llm = new FakeLlm(['{"n":"1"}']);
    const t = z.object({ n: z.string() }).transform((v) => Number(v.n));
    await expect(
      completeStructured(llm, request, t as unknown as z.ZodType<number>, () => 0),
    ).rejects.toThrow(/\.transform/);
    expect(llm.calls).toHaveLength(0);
  });

  it('rejects a transform nested in objects, arrays, optionals, unions and pipelines', async () => {
    const t = z.string().transform((v) => v.length);
    const nested = [
      z.object({ a: z.object({ b: t }) }),
      z.object({ a: z.array(t) }),
      z.object({ a: t.optional() }),
      z.object({ a: t.nullable().default(null) }),
      z.object({ a: z.union([z.number(), t]) }),
      z.object({ a: z.record(z.string(), t) }),
      z.object({ a: z.tuple([z.string(), t]) }),
      z.object({ a: z.string().pipe(t) }),
      z.object({ a: z.intersection(z.object({ x: z.string() }), z.object({ y: t })) }),
      z.discriminatedUnion('k', [z.object({ k: z.literal('a'), v: t })]),
    ];
    for (const schema of nested) {
      await expect(attempt(schema)).rejects.toThrow(/\.transform/);
    }
  });

  it('still accepts refine, default, coerce and preprocess', async () => {
    const ok = z.object({
      n: z.coerce.number().refine((v) => v > 0),
      s: z.string().default('x'),
      p: z.preprocess((v) => String(v), z.string()).optional(),
    });
    const llm = new FakeLlm(['{"n":"1"}']);
    const r = await completeStructured(llm, request, ok, () => ({ n: 0, s: 'x', p: undefined }));
    expect(r.source).toBe('model');
    expect(r.value).toMatchObject({ n: 1, s: 'x' });
  });

  it('handles a recursive (lazy) schema without looping', async () => {
    type Node = { name: string; kids?: Node[] };
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({ name: z.string(), kids: z.array(node).optional() }),
    ) as unknown as z.ZodType<Node>;
    const llm = new FakeLlm(['{"name":"a","kids":[{"name":"b"}]}']);
    const r = await completeStructured(llm, request, node, () => ({ name: 'x' }));
    expect(r.source).toBe('model');
  });
});
