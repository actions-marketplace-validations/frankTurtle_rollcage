import { execRunner as sharedExecRunner } from '@adl/shared';
import type { CommandRunner } from './types.ts';

/**
 * The real runner: `execFile` (no shell, so arguments are never interpreted), a timeout, and the
 * result as data. A missing program or a timeout comes back as `error`, never as an exception.
 */
export function execRunner(
  timeoutMs = 60_000,
  extraEnv: Record<string, string> = {},
): CommandRunner {
  return sharedExecRunner({ timeoutMs, env: extraEnv });
}
