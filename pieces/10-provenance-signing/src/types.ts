export type { CommandResult, CommandRunner } from '@adl/shared';

export type VerifyMode = 'key' | 'cosign-keyless' | 'github-attestation';

export const VERIFY_MODES: readonly VerifyMode[] = ['key', 'cosign-keyless', 'github-attestation'];

export type VerifySpec =
  | {
      mode: 'key';
      artifact: string;
      bundle: string;
      publicKey: string;
      /** Adds --insecure-ignore-tlog. Only for signatures that were never logged (the demo). */
      allowNoTlog: boolean;
    }
  | {
      mode: 'cosign-keyless';
      artifact: string;
      bundle: string;
      certIdentity: string;
      certOidcIssuer: string;
    }
  | {
      mode: 'github-attestation';
      artifact: string;
      repo: string;
      signerWorkflow?: string | undefined;
      /** Offline attestation bundle. Without it, gh fetches attestations from GitHub. */
      bundle?: string | undefined;
    };

export interface ArtifactResult {
  artifact: string;
  status: 'verified' | 'failed';
  reason: string;
  sha256?: string | undefined;
}
