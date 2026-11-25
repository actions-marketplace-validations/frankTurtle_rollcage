import { describe, expect, it } from 'vitest';
import { execRunner } from '../src/runner.ts';
import { generateKeyPair, signBlob } from '../src/sign.ts';
import { fail, fakeRunner, ok } from './helpers.ts';

describe('AC-9: the real runner, against harmless local commands', () => {
  it('captures stdout, stderr and the exit code', async () => {
    const run = execRunner(10_000);
    const result = await run(process.execPath, [
      '-e',
      'console.log("out"); console.error("err"); process.exit(3)',
    ]);
    expect(result).toMatchObject({ code: 3 });
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
  });

  it('reports a missing program as an error instead of throwing', async () => {
    const result = await execRunner(10_000)('definitely-not-a-real-program-xyz', []);
    expect(result.code).toBeNull();
    expect(result.error).toMatch(/ENOENT/);
  });

  it('reports a timeout as an error', async () => {
    const result = await execRunner(200)(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)']);
    expect(result.code).toBeNull();
    expect(result.error).toMatch(/timed out|killed|SIGTERM/i);
  });

  it('passes the extra environment through', async () => {
    const result = await execRunner(10_000, { PROV_TEST: 'yes' })(process.execPath, [
      '-e',
      'console.log(process.env.PROV_TEST)',
    ]);
    expect(result.stdout.trim()).toBe('yes');
  });
});

describe('offline signing helpers (demo only)', () => {
  it('generates a key pair with the output prefix', async () => {
    const { runner, calls } = fakeRunner(() => ok());
    await generateKeyPair(runner, '/tmp/x/demo');
    expect(calls[0]).toEqual({
      cmd: 'cosign',
      args: ['generate-key-pair', '--output-key-prefix', '/tmp/x/demo'],
    });
  });

  it('signs without uploading to a transparency log', async () => {
    const { runner, calls } = fakeRunner(() => ok());
    await signBlob(runner, { key: 'k', artifact: 'a.tgz', bundle: 'a.tgz.sigstore.json' });
    const args = calls[0]?.args ?? [];
    expect(calls[0]?.cmd).toBe('cosign');
    expect(args[0]).toBe('sign-blob');
    expect(args).toContain('--tlog-upload=false');
    expect(args).toContain('--use-signing-config=false');
    expect(args).toContain('--yes');
    expect(args.slice(-1)).toEqual(['a.tgz']);
  });

  it('throws with the tool message when a command fails', async () => {
    const { runner } = fakeRunner(() => fail('no key'));
    await expect(generateKeyPair(runner, 'p')).rejects.toThrow(/no key/);
    const missing = fakeRunner(() => ({ code: null, stdout: '', stderr: '', error: 'ENOENT' }));
    await expect(
      signBlob(missing.runner, { key: 'k', artifact: 'a', bundle: 'b' }),
    ).rejects.toThrow(/ENOENT/);
  });
});
