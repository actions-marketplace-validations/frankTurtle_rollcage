import type { LlmClient } from '@adl/shared';
import { err, fatal, ok, textProvider, type ModelProvider, type TextModel } from 'escapement';

/**
 * Escapement's ModelProvider port over the repo's shared LlmClient. The client returns text, so
 * Escapement's JSON turn protocol does the rest. A reply that breaks the format becomes a repair
 * turn inside the run, and a client that throws fails the run closed.
 */
export function llmModelProvider(llm: LlmClient, options: { model?: string } = {}): ModelProvider {
  const model: TextModel = {
    name: 'llm-client',
    async complete({ system, prompt }) {
      try {
        const { text } = await llm.complete({
          system,
          prompt,
          ...(options.model ? { model: options.model } : {}),
        });
        return ok({ text });
      } catch (error) {
        return err(
          fatal('provider.llm_failed', error instanceof Error ? error.message : String(error)),
        );
      }
    },
  };
  return textProvider(model, { name: 'llm-client' });
}
