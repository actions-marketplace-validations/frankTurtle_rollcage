import { z } from 'zod';
import type { ZodType } from 'zod';
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

/** True when the schema, or any schema inside it, applies a `.transform`. */
function hasTransform(schema: z.ZodTypeAny, seen = new Set<z.ZodTypeAny>()): boolean {
  if (seen.has(schema)) return false;
  seen.add(schema);
  const walk = (inner: z.ZodTypeAny): boolean => hasTransform(inner, seen);
  if (schema instanceof z.ZodEffects) {
    return schema._def.effect.type === 'transform' || walk(schema._def.schema);
  }
  if (schema instanceof z.ZodObject) {
    return Object.values<z.ZodTypeAny>(schema.shape).some(walk) || walk(schema._def.catchall);
  }
  if (schema instanceof z.ZodArray) return walk(schema.element);
  if (schema instanceof z.ZodTuple) {
    const rest = schema._def.rest as z.ZodTypeAny | null;
    return schema.items.some(walk) || (rest !== null && walk(rest));
  }
  if (schema instanceof z.ZodRecord) return walk(schema._def.valueType);
  if (schema instanceof z.ZodUnion) return (schema.options as z.ZodTypeAny[]).some(walk);
  if (schema instanceof z.ZodDiscriminatedUnion) {
    return (schema.options as z.ZodTypeAny[]).some(walk);
  }
  if (schema instanceof z.ZodIntersection) {
    return walk(schema._def.left) || walk(schema._def.right);
  }
  if (schema instanceof z.ZodPipeline) return walk(schema._def.in) || walk(schema._def.out);
  if (schema instanceof z.ZodLazy) return walk(schema.schema);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return walk(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) return walk(schema.removeDefault());
  if (schema instanceof z.ZodCatch) return walk(schema.removeCatch());
  if (schema instanceof z.ZodBranded) return walk(schema.unwrap());
  if (schema instanceof z.ZodReadonly) return walk(schema._def.innerType);
  return false;
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
