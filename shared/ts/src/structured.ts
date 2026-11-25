import type { z, ZodType } from 'zod';
import type { LlmClient, LlmRequest } from './llm.js';

export interface StructuredResult<T> {
  value: T;
  /** 'model' when the LLM output validated; 'fallback' when the deterministic result was used. */
  source: 'model' | 'fallback';
  attempts: number;
  /** Why the fallback was used. Present only when source is 'fallback'. */
  reason?: string;
}

/** Pull a JSON object out of model text, tolerating a ```json fence. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  return JSON.parse(candidate);
}

type Schema = z.core.$ZodType;
type Def = { type: string } & Record<string, unknown>;

/**
 * True when the schema, or any schema inside it, applies a `.transform`. A bare transform as the
 * input side of a pipe is `z.preprocess`, which changes the input and not the output, so it is
 * allowed; its output side is still checked.
 */
function hasTransform(schema: Schema, seen = new Set<Schema>(), preprocess = false): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  // Optional members (an object's catchall, a tuple's rest) may be absent.
  const walk = (inner: unknown): boolean => !!inner && hasTransform(inner as Schema, seen);
  const def = schema._zod.def as Def;
  switch (def.type) {
    case 'transform':
      return !preprocess;
    case 'pipe': {
      const input = def.in as Schema;
      const isPreprocess = (input._zod.def as Def).type === 'transform';
      return hasTransform(input, seen, isPreprocess) || walk(def.out);
    }
    case 'object':
      return Object.values(def.shape as Record<string, unknown>).some(walk) || walk(def.catchall);
    case 'array':
      return walk(def.element);
    case 'tuple':
      return (def.items as unknown[]).some(walk) || walk(def.rest);
    case 'record':
      return walk(def.valueType);
    case 'map':
      return walk(def.keyType) || walk(def.valueType);
    case 'set':
      return walk(def.valueType);
    case 'union':
      return (def.options as unknown[]).some(walk);
    case 'intersection':
      return walk(def.left) || walk(def.right);
    case 'lazy':
      return walk((def.getter as () => unknown)());
    case 'optional':
    case 'nullable':
    case 'nonoptional':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'promise':
      return walk(def.innerType);
    default:
      return false;
  }
}

/**
 * Ask the model for JSON and validate it with a schema.
 * Invalid output (or a failed call): retry once, then return `fallback()`.
 * The caller supplies the fallback, so a gate decides what "fail closed" means for its domain.
 * Schemas that use `.transform` are rejected with an error, before any model call.
 */
export async function completeStructured<T>(
  client: LlmClient,
  request: LlmRequest,
  schema: ZodType<T>,
  fallback: () => T,
): Promise<StructuredResult<T>> {
  if (hasTransform(schema)) {
    throw new Error(
      'completeStructured: the schema uses .transform, so its output type differs from what the model returns. Validate with the schema and transform the result afterwards.',
    );
  }
  let reason = 'unknown';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await client.complete(request);
      const parsed = schema.safeParse(extractJson(response.text));
      if (parsed.success) {
        return { value: parsed.data, source: 'model', attempts: attempt };
      }
      reason = `schema validation failed: ${parsed.error.issues[0]?.message ?? 'invalid'}`;
    } catch (error) {
      reason = error instanceof Error ? error.message : 'call failed';
    }
  }
  return { value: fallback(), source: 'fallback', attempts: 2, reason };
}
