import { execFile } from 'node:child_process';
import type { CommandRunner } from './types.ts';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * The real runner: `execFile` (no shell, so arguments are never interpreted), a timeout, and the
 * result as data. A missing program or a timeout comes back as `error`, never as an exception.
 */
export function execRunner(
  timeoutMs = 60_000,
  extraEnv: Record<string, string> = {},
): CommandRunner {
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          env: { ...process.env, ...extraEnv },
        },
        (error, stdout, stderr) => {
          if (!error) return resolve({ code: 0, stdout, stderr });
          const code = typeof error.code === 'number' ? error.code : null;
          if (code !== null) return resolve({ code, stdout, stderr });
          const reason = error.killed
            ? `timed out after ${timeoutMs} ms (${error.message})`
            : error.message;
          resolve({ code: null, stdout, stderr, error: reason });
        },
      );
    });
}
