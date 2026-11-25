import { execFile } from 'node:child_process';

export interface CommandResult {
  /** Exit code, or null when the process never ran to completion (not found, timeout). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not start or was killed. */
  error?: string;
  /** The Node error code (for example ENOENT) when the process could not start. */
  errorCode?: string;
}

/** Runs an external tool. Never throws for a failing tool; tests inject a fake. */
export type CommandRunner = (cmd: string, args: string[]) => Promise<CommandResult>;

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * The real runner: `execFile` (no shell, so arguments are never interpreted), an optional timeout,
 * and the result as data. A missing program or a timeout comes back as `error`, never as an
 * exception.
 */
export function execRunner(
  options: {
    timeoutMs?: number;
    env?: Record<string, string>;
    cwd?: string;
  } = {},
): CommandRunner {
  const { timeoutMs = 60_000, env, cwd } = options;
  return (cmd, args) =>
    new Promise((resolve) => {
      execFile(
        cmd,
        args,
        {
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT_BYTES,
          ...(cwd ? { cwd } : {}),
          env: { ...process.env, ...env },
        },
        (error, stdout, stderr) => {
          if (!error) return resolve({ code: 0, stdout, stderr });
          if (typeof error.code === 'number') return resolve({ code: error.code, stdout, stderr });
          const reason = error.killed
            ? `timed out after ${timeoutMs} ms (${error.message})`
            : error.message;
          resolve({
            code: null,
            stdout,
            stderr,
            error: reason,
            ...(typeof error.code === 'string' ? { errorCode: error.code } : {}),
          });
        },
      );
    });
}
