import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AnthropicLlm,
  RecordReplayLlm,
  UnavailableLlm,
  parseLlmMode,
  selectLlm,
} from '../src/index.js';

describe('parseLlmMode', () => {
  it('accepts the four modes and rejects anything else', () => {
    for (const mode of ['auto', 'live', 'replay', 'none']) expect(parseLlmMode(mode)).toBe(mode);
    expect(() => parseLlmMode('fast')).toThrow('--llm must be');
  });
});

describe('selectLlm', () => {
  it('chooses by mode', () => {
    const key = { ANTHROPIC_API_KEY: 'k' };
    expect(selectLlm('none', {})).toBeInstanceOf(UnavailableLlm);
    expect(selectLlm('auto', {})).toBeInstanceOf(UnavailableLlm);
    expect(selectLlm('auto', key)).toBeInstanceOf(AnthropicLlm);
    expect(selectLlm('live', key)).toBeInstanceOf(AnthropicLlm);
    expect(selectLlm('replay', {}, mkdtempSync(join(tmpdir(), 'adl-')))).toBeInstanceOf(
      RecordReplayLlm,
    );
    expect(() => selectLlm('live', {})).toThrow('ANTHROPIC_API_KEY');
  });

  it('names the caller fixtures flag when replay has no directory', () => {
    expect(() => selectLlm('replay', {})).toThrow('--llm-fixtures');
    expect(() => selectLlm('replay', {}, undefined, '--fixtures')).toThrow(
      '--llm replay requires --fixtures <dir>',
    );
  });

  it('UnavailableLlm always rejects with its reason', async () => {
    await expect(new UnavailableLlm('why').complete()).rejects.toThrow('why');
    await expect(selectLlm('none', {}).complete({ prompt: 'x' })).rejects.toThrow('--llm none');
  });
});
