import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnthropicLlm, RecordReplayLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { createLlm } from '../src/llm.js';

const dir = () => mkdtempSync(join(tmpdir(), 'pg-llm-'));

describe('createLlm', () => {
  it('replays recorded responses by default and never needs a key', async () => {
    const llm = createLlm(false, {}, dir());
    expect(llm).toBeInstanceOf(RecordReplayLlm);
    await expect(llm.complete({ prompt: 'unrecorded' })).rejects.toThrow(/no recorded fixture/);
  });

  it('uses the Anthropic client in live mode', () => {
    expect(createLlm(true, { ANTHROPIC_API_KEY: 'sk-ant-fake-for-test' }, dir())).toBeInstanceOf(
      AnthropicLlm,
    );
  });

  it('refuses live mode without an API key', () => {
    expect(() => createLlm(true, {}, dir())).toThrow(/ANTHROPIC_API_KEY/);
  });
});
