import type { CommandResult, CommandRunner } from './types.ts';

function must(what: string, result: CommandResult): void {
  if (result.code === 0) return;
  const detail = result.error ?? (result.stderr.trim() || `exit ${result.code}`);
  throw new Error(`${what} failed: ${detail}`);
}

/** Offline demo only: a throwaway cosign key pair at `<prefix>.key` and `<prefix>.pub`. */
export async function generateKeyPair(runner: CommandRunner, prefix: string): Promise<void> {
  must(
    'cosign generate-key-pair',
    await runner('cosign', ['generate-key-pair', '--output-key-prefix', prefix]),
  );
}

/**
 * Offline demo only: sign a file with a local key and write a bundle. `--tlog-upload=false` keeps
 * the signature off the public log. cosign 3 rejects that flag alone when writing a bundle, so
 * `--use-signing-config=false` goes with it (deprecated upstream; see the README security notes).
 */
export async function signBlob(
  runner: CommandRunner,
  opts: { key: string; artifact: string; bundle: string },
): Promise<void> {
  const args = [
    'sign-blob',
    ...['--key', opts.key],
    ...['--bundle', opts.bundle],
    ...['--use-signing-config=false', '--tlog-upload=false', '--yes'],
    opts.artifact,
  ];
  must('cosign sign-blob', await runner('cosign', args));
}
