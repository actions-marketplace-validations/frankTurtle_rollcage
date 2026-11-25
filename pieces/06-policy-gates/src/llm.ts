import { AnthropicLlm, RecordReplayLlm, type LlmClient } from '@adl/shared';

/**
 * Recorded responses by default, so nothing reaches the network. `live` opts in to the Anthropic
 * API; the model id comes from ANTHROPIC_MODEL through the shared config.
 */
export function createLlm(
  live: boolean,
  env: Record<string, string | undefined>,
  fixtureDir: string,
): LlmClient {
  return live ? new AnthropicLlm(env) : new RecordReplayLlm(fixtureDir, 'replay');
}
