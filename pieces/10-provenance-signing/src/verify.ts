import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import type { ArtifactResult, CommandResult, CommandRunner, VerifySpec } from './types.ts';

export interface Command {
  cmd: string;
  args: string[];
}

/** The success line `cosign verify-blob` prints. Exit 0 without it is treated as ambiguous. */
const COSIGN_OK = 'Verified OK';

/** Build the verifier command for one artifact. Flags checked against cosign 3.1.5 and gh 2.98.0. */
export function buildVerifyCommand(spec: VerifySpec): Command {
  switch (spec.mode) {
    case 'key':
      return {
        cmd: 'cosign',
        args: [
          'verify-blob',
          ...['--key', spec.publicKey],
          ...['--bundle', spec.bundle],
          ...(spec.allowNoTlog ? ['--insecure-ignore-tlog'] : []),
          spec.artifact,
        ],
      };
    case 'cosign-keyless':
      return {
        cmd: 'cosign',
        args: [
          'verify-blob',
          ...['--bundle', spec.bundle],
          ...['--certificate-identity', spec.certIdentity],
          ...['--certificate-oidc-issuer', spec.certOidcIssuer],
          spec.artifact,
        ],
      };
    case 'github-attestation':
      return {
        cmd: 'gh',
        args: [
          ...['attestation', 'verify', spec.artifact],
          ...['--repo', spec.repo],
          ...['--format', 'json'],
          ...(spec.signerWorkflow ? ['--signer-workflow', spec.signerWorkflow] : []),
          ...(spec.bundle ? ['--bundle', spec.bundle] : []),
        ],
      };
  }
}

/** Only the parts of `gh attestation verify --format json` the gate relies on. */
const GhOutputSchema = z
  .array(
    z.object({
      verificationResult: z.object({
        statement: z.object({
          subject: z.array(z.object({ digest: z.record(z.string()) })),
        }),
      }),
    }),
  )
  .min(1);

const failed = (artifact: string, reason: string, sha256?: string): ArtifactResult => ({
  artifact,
  status: 'failed',
  reason,
  sha256,
});

/** The last stderr line, without cosign's boilerplate prefixes, so the reason fits on one screen line. */
const lastLine = (text: string): string =>
  (text.trim().split('\n').pop() ?? '')
    .replace(/^(Error: |error during command execution: )+/, '')
    .replace(/^failed to verify signature: could not verify message: /, '')
    .trim();

/** Judge cosign's result. Both the exit code and the success line must agree. */
function judgeCosign(result: CommandResult): string | undefined {
  if (result.code !== 0) return `cosign exited ${result.code}: ${lastLine(result.stderr)}`;
  const said = `${result.stdout}\n${result.stderr}`.includes(COSIGN_OK);
  return said ? undefined : 'ambiguous result: cosign exited 0 without printing "Verified OK"';
}

/** Judge gh's JSON: at least one verified statement must name this file's sha256 as a subject. */
function judgeGh(result: CommandResult, digest: string): string | undefined {
  if (result.code !== 0) return `gh exited ${result.code}: ${lastLine(result.stderr)}`;
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return 'ambiguous result: gh output is not JSON';
  }
  const parsed = GhOutputSchema.safeParse(json);
  if (!parsed.success) return 'ambiguous result: gh output has no verified attestation statement';
  const named = parsed.data.some((entry) =>
    entry.verificationResult.statement.subject.some((s) => s.digest['sha256'] === digest),
  );
  return named ? undefined : 'attestation subject digest does not match this file';
}

/**
 * Verify one artifact. Never throws: every problem becomes a `failed` result with a reason, so the
 * gate fails closed.
 */
export async function verifyArtifact(
  spec: VerifySpec,
  runner: CommandRunner,
): Promise<ArtifactResult> {
  const { artifact } = spec;
  if (!existsSync(artifact)) return failed(artifact, 'artifact not found');
  const digest = createHash('sha256').update(readFileSync(artifact)).digest('hex');
  if (spec.bundle && !existsSync(spec.bundle)) {
    return failed(artifact, `no signature bundle at ${spec.bundle}`, digest);
  }

  const { cmd, args } = buildVerifyCommand(spec);
  let result: CommandResult;
  try {
    result = await runner(cmd, args);
  } catch (e) {
    return failed(
      artifact,
      `verifier crashed: ${e instanceof Error ? e.message : String(e)}`,
      digest,
    );
  }
  if (result.error) return failed(artifact, `could not run ${cmd}: ${result.error}`, digest);

  const problem =
    spec.mode === 'github-attestation' ? judgeGh(result, digest) : judgeCosign(result);
  return problem
    ? failed(artifact, problem, digest)
    : { artifact, status: 'verified', reason: 'signature verified', sha256: digest };
}
