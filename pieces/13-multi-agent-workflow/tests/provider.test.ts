import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { system, user } from 'escapement';
import { LlmModelProvider } from '../src/provider.js';

const ctx = { runId: 'r', stepId: 's', attempt: 1 };
const req = {
  messages: [system('You are the planner.'), user('Do the task')],
  tools: [],
};
const valid = JSON.stringify({
  say: 'ok',
  tool_calls: [{ name: 'read_file', args: { path: 'a' } }],
});

describe('LlmModelProvider', () => {
  it('turns a valid JSON reply into a model response with tool calls', async () => {
    const llm = new FakeLlm([valid]);
    const res = await new LlmModelProvider(llm).generate(req, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.stopReason).toBe('tool_use');
    expect(res.value.message.content).toBe('ok');
    expect(res.value.message.toolCalls?.[0]).toMatchObject({
      name: 'read_file',
      args: { path: 'a' },
    });
    expect(llm.calls[0]?.system).toContain('You are the planner.');
    expect(llm.calls[0]?.prompt).toContain('Do the task');
  });

  it('ends the turn when there are no tool calls', async () => {
    const res = await new LlmModelProvider(new FakeLlm([JSON.stringify({ say: 'done' })])).generate(
      req,
      ctx,
    );
    expect(res.ok && res.value.stopReason).toBe('end_turn');
  });

  it('retries once on invalid output, then recovers', async () => {
    const llm = new FakeLlm(['not json', valid]);
    const res = await new LlmModelProvider(llm).generate(req, ctx);
    expect(res.ok).toBe(true);
    expect(llm.calls).toHaveLength(2);
  });

  it('fails closed after one retry and says why', async () => {
    const llm = new FakeLlm(['nope', '{"say": 3}']);
    const res = await new LlmModelProvider(llm).generate(req, ctx);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ class: 'fatal', code: 'provider.invalid_output' });
    expect(llm.calls).toHaveLength(2);
  });

  it('fails closed when the client throws', async () => {
    const res = await new LlmModelProvider(
      new FakeLlm([new Error('boom'), new Error('boom')]),
    ).generate(req, ctx);
    expect(res.ok).toBe(false);
  });

  it('never hard-codes a model id and passes through one it is given', async () => {
    const a = new FakeLlm([valid]);
    await new LlmModelProvider(a).generate(req, ctx);
    expect(a.calls[0]?.model).toBeUndefined();
    const b = new FakeLlm([valid]);
    await new LlmModelProvider(b, { model: 'm-from-env' }).generate(req, ctx);
    expect(b.calls[0]?.model).toBe('m-from-env');
  });

  it('renders tool results back to the model', async () => {
    const llm = new FakeLlm([valid]);
    await new LlmModelProvider(llm).generate(
      {
        messages: [
          system('s'),
          user('goal'),
          {
            role: 'assistant',
            content: 'reading',
            toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a' } }],
          },
          { role: 'tool', callId: 'c1', name: 'read_file', content: 'FILE-BODY', isError: false },
        ],
        tools: [],
      },
      ctx,
    );
    expect(llm.calls[0]?.prompt).toContain('FILE-BODY');
    expect(llm.calls[0]?.prompt).toContain('read_file');
  });
});
