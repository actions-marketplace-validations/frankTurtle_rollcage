import { describe, expect, it } from 'vitest';
import { buildVerifyCommand, verifyArtifact } from '../src/verify.ts';
import type { VerifySpec } from '../src/types.ts';
import { fail, fakeRunner, ghJson, ok, sha256, workdir } from './helpers.ts';

const keySpec = (artifact: string, extra: Partial<VerifySpec> = {}): VerifySpec =>
  ({
    mode: 'key',
    artifact,
    bundle: `${artifact}.sigstore.json`,
    publicKey: 'signer.pub',
    allowNoTlog: false,
    ...extra,
  }) as VerifySpec;

const keylessSpec = (artifact: string): VerifySpec => ({
  mode: 'cosign-keyless',
  artifact,
  bundle: `${artifact}.sigstore.json`,
  certIdentity: 'https://github.com/o/r/.github/workflows/release.yml@refs/heads/main',
  certOidcIssuer: 'https://token.actions.githubusercontent.com',
});

const ghSpec = (artifact: string, extra: Partial<VerifySpec> = {}): VerifySpec =>
  ({
    mode: 'github-attestation',
    artifact,
    repo: 'o/r',
    signerWorkflow: 'o/r/.github/workflows/release.yml',
    ...extra,
  }) as VerifySpec;

describe('AC-8: command construction', () => {
  it('builds the cosign key command and adds --insecure-ignore-tlog only when allowed', () => {
    const base = buildVerifyCommand(keySpec('a.tgz'));
    expect(base.cmd).toBe('cosign');
    expect(base.args).toEqual([
      'verify-blob',
      '--key',
      'signer.pub',
      '--bundle',
      'a.tgz.sigstore.json',
      'a.tgz',
    ]);
    const relaxed = buildVerifyCommand(keySpec('a.tgz', { allowNoTlog: true }));
    expect(relaxed.args).toContain('--insecure-ignore-tlog');
  });

  it('builds the cosign keyless command with identity and issuer', () => {
    const { cmd, args } = buildVerifyCommand(keylessSpec('a.tgz'));
    expect(cmd).toBe('cosign');
    expect(args).toEqual([
      'verify-blob',
      '--bundle',
      'a.tgz.sigstore.json',
      '--certificate-identity',
      'https://github.com/o/r/.github/workflows/release.yml@refs/heads/main',
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      'a.tgz',
    ]);
  });

  it('builds the gh command with repo, signer workflow and json output', () => {
    const { cmd, args } = buildVerifyCommand(ghSpec('a.tgz', { bundle: 'a.jsonl' }));
    expect(cmd).toBe('gh');
    expect(args).toEqual([
      'attestation',
      'verify',
      'a.tgz',
      '--repo',
      'o/r',
      '--format',
      'json',
      '--signer-workflow',
      'o/r/.github/workflows/release.yml',
      '--bundle',
      'a.jsonl',
    ]);
    const bare = buildVerifyCommand(ghSpec('a.tgz', { signerWorkflow: undefined }));
    expect(bare.args).not.toContain('--signer-workflow');
    expect(bare.args).not.toContain('--bundle');
  });
});

describe('AC-1 and AC-2: cosign output handling', () => {
  it('verifies when cosign exits 0 and prints Verified OK', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const { runner, calls } = fakeRunner(() => ok('', 'Verified OK'));
    for (const spec of [keySpec(art), keylessSpec(art)]) {
      const result = await verifyArtifact(spec, runner);
      expect(result).toMatchObject({ artifact: art, status: 'verified', sha256: sha256('bytes') });
    }
    expect(calls).toHaveLength(2);
  });

  it('fails on a non-zero exit and keeps the reason', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const { runner } = fakeRunner(() => fail('invalid signature when validating ASN.1'));
    const result = await verifyArtifact(keySpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('invalid signature');
  });

  it('fails as ambiguous when exit is 0 but the success line is missing', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const { runner } = fakeRunner(() => ok('', 'something else'));
    const result = await verifyArtifact(keySpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/ambiguous/i);
  });
});

describe('AC-1 and AC-3: gh attestation output handling', () => {
  it('verifies when the json lists a subject with the artifact digest', async () => {
    const w = workdir();
    const art = w.file('pkg-1.0.0.tgz', 'bytes');
    const { runner } = fakeRunner(() => ok(ghJson(sha256('bytes'))));
    expect((await verifyArtifact(ghSpec(art), runner)).status).toBe('verified');
  });

  it.each([
    ['empty output', ''],
    ['non-json output', 'Loaded digest sha256:abc'],
    ['an empty array', '[]'],
    ['an unexpected shape', '{"hello":"world"}'],
    ['entries without a statement', '[{"verificationResult":{}}]'],
    ['a digest for other bytes', ghJson(sha256('other bytes'))],
  ])('fails on %s', async (_label, stdout) => {
    const w = workdir();
    const art = w.file('pkg-1.0.0.tgz', 'bytes');
    const { runner } = fakeRunner(() => ok(stdout));
    const result = await verifyArtifact(ghSpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('fails when gh exits non-zero even if stdout looks valid', async () => {
    const w = workdir();
    const art = w.file('pkg-1.0.0.tgz', 'bytes');
    const { runner } = fakeRunner(() => ({
      code: 1,
      stdout: ghJson(sha256('bytes')),
      stderr: 'x',
    }));
    expect((await verifyArtifact(ghSpec(art), runner)).status).toBe('failed');
  });
});

describe('AC-4: failures before or around the tool', () => {
  it('fails without running anything when the artifact is missing', async () => {
    const { runner, calls } = fakeRunner(() => ok('', 'Verified OK'));
    const result = await verifyArtifact(keySpec('/nonexistent/a.tgz'), runner);
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.reason).toMatch(/artifact not found/i);
    expect(calls).toHaveLength(0);
  });

  it('fails without running anything when the bundle is missing (unsigned)', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    const { runner, calls } = fakeRunner(() => ok('', 'Verified OK'));
    const result = await verifyArtifact(keySpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason).toMatch(/no signature bundle/i);
    expect(calls).toHaveLength(0);
  });

  it('fails when the runner cannot start the tool', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const { runner } = fakeRunner(() => ({
      code: null,
      stdout: '',
      stderr: '',
      error: 'spawn cosign ENOENT',
    }));
    const result = await verifyArtifact(keySpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('ENOENT');
  });

  it('fails when the runner itself throws', async () => {
    const w = workdir();
    const art = w.file('a.tgz', 'bytes');
    w.file('a.tgz.sigstore.json', '{}');
    const { runner } = fakeRunner(() => {
      throw new Error('runner exploded');
    });
    const result = await verifyArtifact(keySpec(art), runner);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('runner exploded');
  });
});
