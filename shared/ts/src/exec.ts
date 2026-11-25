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
    /** Kill the program after this long. Default: no timeout. */
    timeoutMs?: number;
    env?: Record<string, string>;
    /** Reject, with a Node-style `code` such as ENOENT, when the program cannot start. */
    throwOnStartError?: boolean;
  } = {},
): CommandRunner {
  const { timeoutMs, env, throwOnStartError = false } = options;
  return (cmd, args) =>
    new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        { timeout: timeoutMs ?? 0, maxBuffer: MAX_OUTPUT_BYTES, env: { ...process.env, ...env } },
        (error, stdout, stderr) => {
          if (!error) return resolve({ code: 0, stdout, stderr });
          if (typeof error.code === 'number') return resolve({ code: error.code, stdout, stderr });
          if (throwOnStartError) return reject(error);
          const reason =
            error.killed && timeoutMs
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
