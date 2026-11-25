import { execRunner } from '@adl/shared';
import { z } from 'zod';
import type { Mapping } from './mapping.js';
import type { Violation } from './types.js';

export interface RunOptions {
  paths: string[];
  policy: string;
  /** Regex of paths conftest should skip. */
  ignore: string;
}

/** Runs conftest and returns its JSON output. The only place that starts a process. */
export interface ConftestRunner {
  run(options: RunOptions): Promise<string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type ExecFn = (file: string, args: string[]) => Promise<ExecResult>;

/** Resolves with the exit code for a process that ran, rejects when it could not start. */
const defaultExec: ExecFn = async (file, args) => {
  const r = await execRunner({ timeoutMs: 0 })(file, args);
  if (r.code === null) {
    throw Object.assign(
      new Error(r.error ?? 'could not start'),
      r.errorCode ? { code: r.errorCode } : {},
    );
  }
  return { stdout: r.stdout, stderr: r.stderr, code: r.code };
};

export function createConftestRunner(exec: ExecFn = defaultExec): ConftestRunner {
  return {
    async run({ paths, policy, ignore }) {
      const args = [
        'test',
        '--all-namespaces',
        '--no-color',
        '-o',
        'json',
        '-p',
        policy,
        '--ignore',
        ignore,
        ...paths,
      ];
      let result: ExecResult;
      try {
        result = await exec('conftest', args);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(
            'conftest was not found on PATH (install: https://www.conftest.dev/install/)',
          );
        }
        throw error;
      }
      // Exit 1 means violations and still prints JSON. No output means conftest itself failed.
      if (result.stdout.trim() === '') {
        throw new Error(`conftest failed (exit ${result.code}): ${result.stderr.trim()}`);
      }
      return result.stdout;
    },
  };
}

const outputSchema = z.array(
  z.object({
    filename: z.string(),
    failures: z.array(z.object({ msg: z.string() })).default([]),
  }),
);

export interface Failure {
  file: string;
  msg: string;
}

/** Failures only. Conftest warnings and exceptions do not fail the gate. */
export function parseConftestOutput(text: string): Failure[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Could not read conftest output: it was not JSON');
  }
  const parsed = outputSchema.safeParse(data);
  if (!parsed.success) throw new Error('Could not read conftest output: unexpected shape');
  return parsed.data.flatMap((r) => r.failures.map((f) => ({ file: r.filename, msg: f.msg })));
}

const RULE_PREFIX = /^(PG\d{3}):\s*/;

export function toViolations(failures: Failure[], mapping: Mapping): Violation[] {
  return failures
    .map(({ file, msg }): Violation => {
      const ruleId = RULE_PREFIX.exec(msg)?.[1] ?? 'UNKNOWN';
      const rule = mapping.rules[ruleId];
      return {
        ruleId,
        message: msg.replace(RULE_PREFIX, ''),
        file,
        controls: rule?.controls ?? [],
        title: rule?.title ?? 'Unmapped rule',
        remediation: rule?.remediation ?? 'No remediation text is mapped for this rule.',
      };
    })
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.message.localeCompare(b.message),
    );
}
