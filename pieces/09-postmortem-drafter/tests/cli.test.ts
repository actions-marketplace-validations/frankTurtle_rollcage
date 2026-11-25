import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm, RecordReplayLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { loadBundle } from '../src/bundle.js';
import { runCli } from '../src/cli.js';
import { draftPostmortem } from '../src/draft.js';
import { PLANTED, sampleBundleFiles } from '../src/sample-bundle.js';
import { goodReply } from './helpers.js';

function writeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pm-bundle-'));
  for (const [name, content] of Object.entries(sampleBundleFiles())) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

async function run(args: string[], env: Record<string, string | undefined> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, { env, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('AC-11 cli', () => {
  it('drafts offline without a model flag, writes both files and is deterministic', async () => {
    const bundle = writeBundle();
    const outA = join(mkdtempSync(join(tmpdir(), 'pm-out-')), 'a');
    const outB = join(mkdtempSync(join(tmpdir(), 'pm-out-')), 'b');
    const a = await run(['draft', '--bundle', bundle, '--out', outA]);
    const b = await run(['draft', '--bundle', bundle, '--out', outB]);
    expect(a.code).toBe(0);
    expect(a.out).toContain('fallback');
    expect(a.out).toContain('values removed');
    const md = readFileSync(join(outA, 'postmortem.md'), 'utf8');
    expect(md).toBe(readFileSync(join(outB, 'postmortem.md'), 'utf8'));
    expect(readFileSync(join(outA, 'redaction-report.json'), 'utf8')).toBe(
      readFileSync(join(outB, 'redaction-report.json'), 'utf8'),
    );
    expect(a.out + md + b.out).not.toContain(PLANTED[0]?.value as string);
    for (const p of PLANTED) {
      expect(a.out).not.toContain(p.value);
      expect(readFileSync(join(outA, 'redaction-report.json'), 'utf8')).not.toContain(p.value);
    }
  });

  it('replays recorded responses with --fixtures and falls back when none match', async () => {
    const bundle = writeBundle();
    const fixtures = mkdtempSync(join(tmpdir(), 'pm-fx-'));
    const recorder = new RecordReplayLlm(fixtures, 'record', new FakeLlm([goodReply]));
    await draftPostmortem(loadBundle(bundle), recorder);
    const hit = await run([
      'draft',
      '--bundle',
      bundle,
      '--out',
      join(fixtures, 'o1'),
      '--fixtures',
      fixtures,
    ]);
    expect(hit.out).toContain('source: model');
    const miss = await run([
      'draft',
      '--bundle',
      bundle,
      '--out',
      join(fixtures, 'o2'),
      '--fixtures',
      join(fixtures, 'empty'),
    ]);
    expect(miss.out).toContain('source: fallback');
    expect(miss.out).toContain('no recorded fixture');
  });

  it('refuses live mode without a key and never reaches the network', async () => {
    const bundle = writeBundle();
    const r = await run(['draft', '--bundle', bundle, '--live'], {});
    expect(r.code).toBe(1);
    expect(r.err).toContain('ANTHROPIC_API_KEY');
    const viaEnv = await run(['draft', '--bundle', bundle], { DEMO_LIVE: '1' });
    expect(viaEnv.code).toBe(1);
  });

  it('prints the metrics from an incidents file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-inc-'));
    const file = join(dir, 'incidents.json');
    writeFileSync(
      file,
      JSON.stringify([
        {
          id: 'a',
          closed_at: '2026-03-01T00:00:00Z',
          postmortem_published_at: '2026-03-02T00:00:00Z',
        },
        { id: 'b', closed_at: '2026-03-01T00:00:00Z', postmortem_published_at: null },
      ]),
    );
    const r = await run(['metrics', '--incidents', file]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('50%');
    expect(r.out).toContain('24');
  });

  it('prints usage for unknown commands and reports errors without a stack', async () => {
    expect((await run([])).code).toBe(2);
    expect((await run(['nope'])).code).toBe(2);
    const missing = await run(['draft']);
    expect(missing.code).toBe(2);
    const bad = await run(['draft', '--bundle', join(tmpdir(), 'does-not-exist-pm')]);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/incident\.json/);
    const noInc = await run(['metrics']);
    expect(noInc.code).toBe(2);
  });
});
