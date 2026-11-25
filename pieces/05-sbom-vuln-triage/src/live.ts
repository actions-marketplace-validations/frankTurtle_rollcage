import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execRunner } from '@adl/shared';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program with a fixed argument list (no shell). Tests inject a fake. */
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

/** The shared `execRunner`, reshaped: a program that cannot start rejects, as `run` expects. */
export const spawnRunner: Runner = async (cmd, args) => {
  const r = await execRunner({ timeoutMs: 0 })(cmd, args);
  if (r.error !== undefined) {
    throw Object.assign(new Error(r.error), r.errorCode ? { code: r.errorCode } : {});
  }
  return { status: r.code, stdout: r.stdout, stderr: r.stderr };
};

async function run(runner: Runner, cmd: string, args: string[]): Promise<string> {
  let result: RunResult;
  try {
    result = await runner(cmd, args);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${cmd} was not found on PATH. Install it first (see README, live mode).`);
    }
    throw error;
  }
  if (result.status !== 0) {
    throw new Error(`${cmd} exited with status ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** Syft on a directory, then Grype on the SBOM Syft produced. Needs both tools and a Grype DB. */
export async function runSyftAndGrype(
  path: string,
  runner: Runner,
): Promise<{ sbom: string; grype: string }> {
  const sbom = await run(runner, 'syft', [`dir:${path}`, '-q', '-o', 'cyclonedx-json']);
  const dir = mkdtempSync(join(tmpdir(), 'sbom-triage-'));
  try {
    const file = join(dir, 'sbom.cdx.json');
    writeFileSync(file, sbom);
    const grype = await run(runner, 'grype', [`sbom:${file}`, '-q', '-o', 'json']);
    return { sbom, grype };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
