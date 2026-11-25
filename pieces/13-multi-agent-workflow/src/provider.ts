import { completeStructured, type LlmClient } from '@adl/shared';
import {
  assistant,
  err,
  fatal,
  ok,
  type JsonObject,
  type Message,
  type ModelCallContext,
  type ModelProvider,
  type ModelRequest,
  type ToolCall,
} from 'escapement';
import { z } from 'zod';

const Turn = z.object({
  say: z.string(),
  tool_calls: z
    .array(z.object({ name: z.string(), args: z.record(z.unknown()).default({}) }))
    .default([]),
});

const PROTOCOL =
  'Reply with one JSON object and nothing else: {"say": string, "tool_calls": [{"name": string, "args": object}]}. ' +
  'Leave tool_calls empty when you are done; "say" is then your final answer.';

function render(message: Message): string {
  switch (message.role) {
    case 'tool':
      return `[tool result: ${message.name}${message.isError ? ' (error)' : ''}]\n${message.content}`;
    case 'assistant': {
      const calls = (message.toolCalls ?? []).map((c) => `${c.name}(${JSON.stringify(c.args)})`);
      return `[assistant]\n${message.content}${calls.length ? `\ncalled: ${calls.join('; ')}` : ''}`;
    }
    default:
      return `[${message.role}]\n${message.content}`;
  }
}

/**
 * Escapement's ModelProvider port over the repo's shared LlmClient. The client returns text, so each
 * turn is a JSON object validated with zod. Invalid output retries once, then the run fails closed.
 */
export class LlmModelProvider implements ModelProvider {
  readonly name = 'llm-client';

  constructor(
    private readonly llm: LlmClient,
    private readonly options: { model?: string } = {},
  ) {}

  async generate(request: ModelRequest, ctx: ModelCallContext) {
    const system = [
      ...request.messages.filter((m) => m.role === 'system').map((m) => m.content),
      PROTOCOL,
    ].join('\n\n');
    const prompt = request.messages
      .filter((m) => m.role !== 'system')
      .map(render)
      .join('\n\n');

    const result = await completeStructured(
      this.llm,
      { system, prompt, ...(this.options.model ? { model: this.options.model } : {}) },
      Turn,
      () => ({ say: '', tool_calls: [] }),
    );
    if (result.source === 'fallback') {
      return err(
        fatal(
          'provider.invalid_output',
          `model output invalid after ${result.attempts} attempts: ${result.reason}`,
        ),
      );
    }

    const toolCalls: ToolCall[] = (result.value.tool_calls ?? []).map((c, i) => ({
      id: `call-${ctx.stepId}-${i + 1}`,
      name: c.name,
      args: c.args as JsonObject,
    }));
    return ok({
      message: assistant(result.value.say, toolCalls),
      usage: {
        promptTokens: Math.ceil((system.length + prompt.length) / 4),
        completionTokens: Math.ceil(result.value.say.length / 4) + toolCalls.length * 24,
      },
      stopReason: toolCalls.length > 0 ? ('tool_use' as const) : ('end_turn' as const),
    });
  }
}
