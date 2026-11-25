import { AnthropicLlm } from './anthropic.js';
import type { LlmClient, LlmResponse } from './llm.js';
import { RecordReplayLlm } from './replay.js';

export type LlmMode = 'auto' | 'live' | 'replay' | 'none';

export function parseLlmMode(value: string): LlmMode {
  if (value === 'auto' || value === 'live' || value === 'replay' || value === 'none') return value;
  throw new Error('--llm must be auto, live, replay or none');
}

/** Stands in when no model is configured. Always fails, so the caller uses its deterministic result. */
export class UnavailableLlm implements LlmClient {
  constructor(private readonly why: string) {}
  async complete(): Promise<LlmResponse> {
    throw new Error(this.why);
  }
}

/**
 * Choose the LLM client.
 * auto: live if ANTHROPIC_API_KEY is set, otherwise none. Never replay, never network without a key.
 * replay: recorded fixtures only. none: deterministic result only.
 * `fixturesFlag` is the CLI flag named in the error when replay has no fixtures directory.
 */
export function selectLlm(
  mode: LlmMode,
  env: Record<string, string | undefined>,
  fixturesDir?: string,
  fixturesFlag = '--llm-fixtures',
): LlmClient {
  switch (mode) {
    case 'live':
      return new AnthropicLlm(env);
    case 'replay':
      if (!fixturesDir) throw new Error(`--llm replay requires ${fixturesFlag} <dir>`);
      return new RecordReplayLlm(fixturesDir, 'replay');
    case 'none':
      return new UnavailableLlm('LLM disabled (--llm none)');
    case 'auto':
      return env['ANTHROPIC_API_KEY']
        ? new AnthropicLlm(env)
        : new UnavailableLlm('ANTHROPIC_API_KEY is not set');
  }
}
