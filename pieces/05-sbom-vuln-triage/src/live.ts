import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a program with a fixed argument list (no shell). Tests inject a fake. */
export type Runner = (cmd: string, args: string[]) => Promise<RunResult>;

export const spawnRunner: Runner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

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
