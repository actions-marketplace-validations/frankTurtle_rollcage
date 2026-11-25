import { describe, expect, it } from 'vitest';
import { execRunner, redactSecrets } from '../src/index.js';

describe('execRunner', () => {
  const run = execRunner({ timeoutMs: 10_000 });
  it('returns stdout and a zero code', async () => {
    expect(await run(process.execPath, ['-e', 'console.log("hi")'])).toEqual({
      code: 0,
      stdout: 'hi\n',
      stderr: '',
    });
  });
  it('returns a non-zero exit code as data', async () => {
    expect(await run(process.execPath, ['-e', 'process.exit(3)'])).toMatchObject({ code: 3 });
  });
  it('reports a missing program without throwing', async () => {
    expect(await run('definitely-not-a-program-xyz', [])).toMatchObject({
      code: null,
      errorCode: 'ENOENT',
    });
  });
  it('reports a timeout', async () => {
    const r = await execRunner({ timeoutMs: 50 })(process.execPath, [
      '-e',
      'setTimeout(()=>{},5000)',
    ]);
    expect(r.code).toBeNull();
    expect(r.error).toMatch(/timed out/);
  });
  it('rejects with a Node error code when asked to', async () => {
    await expect(
      execRunner({ throwOnStartError: true })('definitely-not-a-program-xyz', []),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      execRunner({ throwOnStartError: true })(process.execPath, ['-e', 'process.exit(2)']),
    ).resolves.toMatchObject({ code: 2 });
  });
  it('passes extra env', async () => {
    const r = await execRunner({ env: { ADL_X: 'y' } })(process.execPath, [
      '-e',
      'console.log(process.env.ADL_X)',
    ]);
    expect(r.stdout).toBe('y\n');
  });
});

describe('redactSecrets', () => {
  it('marks secrets and leaves personal data alone', () => {
    const out = redactSecrets(
      `key sk-${'b'.repeat(30)} xoxb-1234567890-abc mail a@example.com 10.0.0.1`,
    );
    expect(out).toContain('[REDACTED:api-key]');
    expect(out).toContain('[REDACTED:slack-token]');
    expect(out).toContain('a@example.com');
    expect(out).toContain('10.0.0.1');
  });
});
