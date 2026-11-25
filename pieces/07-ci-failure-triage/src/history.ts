import { z } from 'zod';
import type { FlakyConfig } from './config.js';
import { attemptKey, ms } from './runs.js';
import type { RunRecord } from './runs.js';

/** Observations kept per test. Older ones are dropped, so the file stays small. */
export const MAX_OBSERVATIONS = 400;

const ObservationSchema = z.object({
  runId: z.number().int(),
  attempt: z.number().int().min(1),
  sha: z.string().min(1),
  outcome: z.enum(['pass', 'fail']),
  at: z.string().datetime(),
});
export type Observation = z.infer<typeof ObservationSchema>;

const HistorySchema = z.object({
  version: z.literal(1),
  tests: z.record(
    z.object({ workflow: z.string().min(1), observations: z.array(ObservationSchema) }),
  ),
});
export type History = z.infer<typeof HistorySchema>;

export const emptyHistory = (): History => ({ version: 1, tests: {} });

export function loadHistory(text?: string): History {
  if (!text?.trim()) return emptyHistory();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('history file is not valid JSON');
  }
  const parsed = HistorySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `history file is invalid: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    );
  }
  return parsed.data;
}

/** Stable output: sorted test ids and a trailing newline, so diffs of the file stay small. */
export function serializeHistory(history: History): string {
  const tests = Object.fromEntries(
    Object.entries(history.tests).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify({ version: 1, tests }, null, 2)}\n`;
}

export interface FlipStats {
  observedCommits: number;
  /** Commits on which the test both failed and passed. */
  flipCommits: number;
  flipRate: number;
}

/** Flip rate: the share of observed commits where the test both failed and passed. */
export function flipStats(history: History, testId: string): FlipStats {
  const outcomes = new Map<string, Set<string>>();
  for (const o of history.tests[testId]?.observations ?? []) {
    outcomes.set(o.sha, (outcomes.get(o.sha) ?? new Set()).add(o.outcome));
  }
  const observedCommits = outcomes.size;
  const flipCommits = [...outcomes.values()].filter((s) => s.size === 2).length;
  return {
    observedCommits,
    flipCommits,
    flipRate: observedCommits ? flipCommits / observedCommits : 0,
  };
}

export function isFlaky(stats: FlipStats, cfg: FlakyConfig): boolean {
  return (
    stats.observedCommits >= cfg.min_observations &&
    stats.flipCommits >= cfg.min_flip_commits &&
    stats.flipRate >= cfg.flip_rate_threshold
  );
}

/**
 * Add run outcomes to the history and return a new one. `failedTests` maps `runId:attempt` to the
 * test ids that failed in that attempt. Failures register tests; every passing run then adds a pass
 * for each test already tracked in its workflow. Order does not matter, and recording the same
 * runs twice changes nothing. Cancelled runs are ignored.
 */
export function recordRuns(
  history: History,
  runs: readonly RunRecord[],
  failedTests: ReadonlyMap<string, readonly string[]>,
): History {
  const tests: History['tests'] = Object.fromEntries(
    Object.entries(history.tests).map(([id, t]) => [
      id,
      { ...t, observations: [...t.observations] },
    ]),
  );
  const seen = new Set(
    Object.entries(tests).flatMap(([id, t]) =>
      t.observations.map((o) => `${id}|${o.runId}:${o.attempt}|${o.outcome}`),
    ),
  );
  const add = (
    id: string,
    workflow: string,
    run: RunRecord,
    outcome: Observation['outcome'],
  ): void => {
    const key = `${id}|${attemptKey(run)}|${outcome}`;
    if (seen.has(key)) return;
    seen.add(key);
    (tests[id] ??= { workflow, observations: [] }).observations.push({
      runId: run.id,
      attempt: run.attempt,
      sha: run.sha,
      outcome,
      at: run.completedAt,
    });
  };

  for (const run of runs.filter((r) => r.conclusion === 'failure')) {
    for (const id of failedTests.get(attemptKey(run)) ?? []) add(id, run.workflow, run, 'fail');
  }
  for (const run of runs.filter((r) => r.conclusion === 'success')) {
    for (const [id, t] of Object.entries(tests)) {
      if (t.workflow === run.workflow) add(id, run.workflow, run, 'pass');
    }
  }
  for (const t of Object.values(tests)) {
    t.observations.sort(
      (a, b) => ms(a.at) - ms(b.at) || a.runId - b.runId || a.attempt - b.attempt,
    );
    t.observations = t.observations.slice(-MAX_OBSERVATIONS);
  }
  return { version: 1, tests };
}
