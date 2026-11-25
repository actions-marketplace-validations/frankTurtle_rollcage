import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import { GateReportSchema } from '../src/report.ts';
import { fakeRunner, ghJson, ok, sha256, workdir } from './helpers.ts';
import type { Call } from './helpers.ts';

function harness(answer: (call: Call) => ReturnType<typeof ok>) {
  const out: string[] = [];
  const err: string[] = [];
  const { runner, calls } = fakeRunner(answer);
  const run = (argv: string[]) =>
    runCli(argv, { runner, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { run, out, err, calls };
}

describe('AC-7: usage errors exit 2', () => {
  it.each([
    ['no command', []],
    ['an unknown command', ['deploy']],
    ['gate with no mode', ['gate', '--artifact', 'a.tgz']],
    ['gate with an unknown mode', ['gate', '--mode', 'magic', '--artifact', 'a.tgz']],
    ['key mode with no public key', ['gate', '--mode', 'key', '--artifact', 'a.tgz']],
    ['keyless mode with no identity', ['gate', '--mode', 'cosign-keyless', '--artifact', 'a.tgz']],
    ['github mode with no repo', ['gate', '--mode', 'github-attestation', '--artifact', 'a.tgz']],
    ['an unknown flag', ['gate', '--nope']],
    ['metric with no report', ['metric']],
  ])('%s', async (_label, argv) => {
    const h = harness(() => ok());
    expect(await h.run(argv)).toBe(2);
    expect(h.err.join('\n')).toMatch(/usage|error/i);
    expect(h.calls).toHaveLength(0);
  });

  it('gate with no artifact blocks with exit 1, not a pass', async () => {
    const h = harness(() => ok('', 'Verified OK'));
    expect(await h.run(['gate', '--mode', 'key', '--public-key', 'k.pub'])).toBe(1);
    expect(h.out.join('\n')).toContain('BLOCK');
  });
});

describe('gate command', () => {
  it('exits 0 and prints ALLOW when verification passes, writing the report', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const reportPath = join(w.dir, 'report.json');
    const h = harness(() => ok('', 'Verified OK'));
    const code = await h.run([
      ...['gate', '--mode', 'key', '--public-key', 'k.pub', '--allow-no-tlog'],
      ...['--artifact', art, '--report', reportPath],
    ]);
    expect(code).toBe(0);
    expect(h.out.join('\n')).toContain('ALLOW');
    expect(h.calls[0]?.args).toContain('--insecure-ignore-tlog');
    const report = GateReportSchema.parse(JSON.parse(readFileSync(reportPath, 'utf8')));
    expect(report).toMatchObject({ decision: 'allow', verified: 1, total: 1 });
  });

  it('exits 1 and prints BLOCK with the reason for a failure', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    const h = harness(() => ok('', 'Verified OK'));
    const code = await h.run(['gate', '--mode', 'key', '--public-key', 'k.pub', '--artifact', art]);
    expect(code).toBe(1);
    const text = h.out.join('\n');
    expect(text).toContain('BLOCK');
    expect(text).toMatch(/no signature bundle/i);
    expect(text).toContain('0 of 1');
  });

  it('does not pass --insecure-ignore-tlog unless asked', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const h = harness(() => ok('', 'Verified OK'));
    await h.run(['gate', '--mode', 'key', '--public-key', 'k.pub', '--artifact', art]);
    expect(h.calls[0]?.args).not.toContain('--insecure-ignore-tlog');
  });

  it('runs keyless mode with the default issuer', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const h = harness(() => ok('', 'Verified OK'));
    const code = await h.run([
      ...['gate', '--mode', 'cosign-keyless', '--cert-identity', 'id', '--artifact', art],
    ]);
    expect(code).toBe(0);
    expect(h.calls[0]?.args).toContain('https://token.actions.githubusercontent.com');
  });

  it('runs github mode and checks several artifacts', async () => {
    const w = workdir();
    const a = w.file('a.tgz', 'one');
    const b = w.file('b.tgz', 'two');
    const h = harness((call) => {
      const file = call.args[2] ?? '';
      return ok(ghJson(sha256(file === a ? 'one' : 'two')));
    });
    const code = await h.run([
      ...['gate', '--mode', 'github-attestation', '--repo', 'o/r'],
      ...['--signer-workflow', 'o/r/.github/workflows/release.yml'],
      ...['--artifact', a, '--artifact', b],
    ]);
    expect(code).toBe(0);
    expect(h.calls).toHaveLength(2);
    expect(h.out.join('\n')).toContain('2 of 2');
  });

  it('uses the --bundle value for a single artifact', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    const bundle = w.file('custom.json', '{}');
    const h = harness(() => ok('', 'Verified OK'));
    await h.run([
      ...['gate', '--mode', 'key', '--public-key', 'k.pub', '--artifact', art, '--bundle', bundle],
    ]);
    expect(h.calls[0]?.args).toContain(bundle);
  });
});

describe('metric command', () => {
  it('aggregates report files', async () => {
    const w = workdir();
    const mk = (verified: number, total: number) =>
      JSON.stringify({
        decision: verified === total ? 'allow' : 'block',
        total,
        verified,
        percent: Math.round((verified / total) * 100),
        results: [],
      });
    const r1 = w.file('r1.json', mk(1, 1));
    const r2 = w.file('r2.json', mk(0, 2));
    const h = harness(() => ok());
    expect(await h.run(['metric', '--report', r1, '--report', r2])).toBe(0);
    expect(h.out.join('\n')).toContain('1 of 3 deployed artifacts (33%)');
  });

  it('exits 2 on an unreadable or invalid report', async () => {
    const w = workdir();
    const bad = w.file('bad.json', '{"nope":true}');
    const h = harness(() => ok());
    expect(await h.run(['metric', '--report', bad])).toBe(2);
    expect(await h.run(['metric', '--report', join(w.dir, 'missing.json')])).toBe(2);
  });
});
