import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { PIECE_ROOT, tmpDir } from './helpers.ts';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) },
  };
}

describe('AC8: score command', () => {
  it('prints scores and the ranking, and writes the JSON file with --out', async () => {
    const dir = tmpDir();
    const outFile = join(dir, 'nested', 'scores.json');
    const capture = io();
    const code = await runCli(['score', '--root', PIECE_ROOT, '--out', outFile], capture.io);
    expect(code).toBe(0);
    const text = capture.out.join('\n');
    expect(text).toContain('Tool A');
    expect(text).toContain('60.33');
    expect(text).toContain('Blocked by a gate');
    expect(text).toContain('Tool C');
    expect(capture.err).toEqual([]);

    const json = JSON.parse(readFileSync(outFile, 'utf8')) as {
      schemaVersion: number;
      results: Array<{ tool: string; rank: number }>;
    };
    expect(json.schemaVersion).toBe(1);
    expect(json.results.map((r) => r.tool)).toEqual(['Tool A', 'Tool B', 'Tool C']);
    expect(json.results.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('exits 1 and prints every validation error for an invalid scorecard', async () => {
    const dir = tmpDir();
    const bad = join(dir, 'bad.csv');
    writeFileSync(bad, 'criterion_id,Tool A\nA1,9\n');
    const capture = io();
    const code = await runCli(['score', '--root', PIECE_ROOT, '--scorecard', bad], capture.io);
    expect(code).toBe(1);
    expect(capture.err.join('\n')).toMatch(/integer from 0 to 3/);
    expect(capture.err.join('\n')).toMatch(/missing criterion/);
    expect(capture.out).toEqual([]);
  });

  it('exits 1 when the weights file is not valid JSON', async () => {
    const dir = tmpDir();
    const bad = join(dir, 'weights.json');
    writeFileSync(bad, '{ not json');
    const capture = io();
    const code = await runCli(['score', '--root', PIECE_ROOT, '--weights', bad], capture.io);
    expect(code).toBe(1);
    expect(capture.err.join('\n')).toMatch(/weights/);
  });

  it('exits 1 when the scorecard file does not exist', async () => {
    const capture = io();
    const code = await runCli(
      ['score', '--root', PIECE_ROOT, '--scorecard', join(tmpDir(), 'missing.csv')],
      capture.io,
    );
    expect(code).toBe(1);
    expect(capture.err.join('\n')).toMatch(/missing\.csv/);
  });
});

describe('AC8: usage', () => {
  it('prints usage and exits 2 for no command or an unknown command', async () => {
    const first = io();
    expect(await runCli([], first.io)).toBe(2);
    expect(first.err.join('\n')).toMatch(/Usage/);

    const second = io();
    expect(await runCli(['frobnicate'], second.io)).toBe(2);
    expect(second.err.join('\n')).toMatch(/Usage/);
  });

  it('exits 2 on a bad flag', async () => {
    const capture = io();
    expect(await runCli(['score', '--nope'], capture.io)).toBe(2);
    expect(capture.err.join('\n')).toMatch(/Usage/);
  });
});

describe('AC9: links command', () => {
  it('exits 0 for this piece, skipping external links when offline', async () => {
    const capture = io();
    const code = await runCli(['links', '--root', PIECE_ROOT], capture.io);
    expect(code).toBe(0);
    expect(capture.out.join('\n')).toMatch(/external links skipped \(offline\)/);
  });

  it('exits 1 and lists the broken link for a folder with a missing file', async () => {
    const dir = tmpDir();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'README.md'), '# Top\n\n[gone](missing.md)\n');
    const capture = io();
    const code = await runCli(['links', '--root', dir], capture.io);
    expect(code).toBe(1);
    expect(capture.err.join('\n')).toMatch(/missing\.md/);
  });

  it('checks external links with an injected fetcher only when --live is given', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), '[ok](https://example.test/ok)\n');
    const seen: string[] = [];
    const fetcher = async (url: string) => {
      seen.push(url);
      return { status: 200 };
    };

    const offline = io();
    expect(await runCli(['links', '--root', dir], offline.io, { fetcher })).toBe(0);
    expect(seen).toEqual([]);

    const live = io();
    expect(await runCli(['links', '--root', dir, '--live'], live.io, { fetcher })).toBe(0);
    expect(seen).toEqual(['https://example.test/ok']);
    expect(live.out.join('\n')).toMatch(/external links checked live: 1/);
  });

  it('exits 1 when a live external link fails', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), '[gone](https://example.test/gone)\n');
    const capture = io();
    const code = await runCli(['links', '--root', dir, '--live'], capture.io, {
      fetcher: async () => ({ status: 404 }),
    });
    expect(code).toBe(1);
    expect(capture.err.join('\n')).toMatch(/HTTP 404/);
  });

  it('makes no request under --live when the folder has no external links', async () => {
    const dir = tmpDir();
    writeFileSync(join(dir, 'README.md'), 'no links here\n');
    const capture = io();
    // No injected fetcher: with no external links, the default fetch is never called.
    expect(await runCli(['links', '--root', dir, '--live'], capture.io)).toBe(0);
  });
});
