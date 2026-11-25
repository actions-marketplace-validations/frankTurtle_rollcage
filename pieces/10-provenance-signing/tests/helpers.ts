import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandResult, CommandRunner } from '../src/types.ts';

export interface Call {
  cmd: string;
  args: string[];
}

/** A runner that never starts a process: it records calls and answers from a script. */
export function fakeRunner(answer: (call: Call) => CommandResult | Promise<CommandResult>): {
  runner: CommandRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: CommandRunner = async (cmd, args) => {
    const call = { cmd, args: [...args] };
    calls.push(call);
    return answer(call);
  };
  return { runner, calls };
}

export const ok = (stdout = '', stderr = ''): CommandResult => ({ code: 0, stdout, stderr });
export const fail = (stderr = 'boom', code = 1): CommandResult => ({
  code,
  stdout: '',
  stderr,
});

export const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export interface Workdir {
  dir: string;
  /** Write a file in the work dir and return its path. */
  file: (name: string, content: string) => string;
}

export function workdir(): Workdir {
  const dir = mkdtempSync(join(tmpdir(), 'prov-test-'));
  return {
    dir,
    file: (name, content) => {
      const path = join(dir, name);
      writeFileSync(path, content);
      return path;
    },
  };
}

/** Hand-written stand-in for `gh attestation verify --format json` (shape per the gh docs). */
export function ghJson(digestHex: string, name = 'pkg-1.0.0.tgz'): string {
  return JSON.stringify([
    {
      attestation: { bundle: {} },
      verificationResult: {
        signature: { certificate: { sourceRepositoryURI: 'https://github.com/example/repo' } },
        verifiedTimestamps: [{ type: 'Tlog', timestamp: '2026-01-01T00:00:00Z' }],
        statement: {
          predicateType: 'https://slsa.dev/provenance/v1',
          subject: [{ name, digest: { sha256: digestHex } }],
          predicate: {},
        },
      },
    },
  ]);
}
