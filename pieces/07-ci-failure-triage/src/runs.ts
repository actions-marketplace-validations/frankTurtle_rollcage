import { z } from 'zod';

/** One attempt of one workflow run. A re-run is a second record with the same id and attempt 2. */
export const RunRecordSchema = z.object({
  id: z.number().int(),
  workflow: z.string().min(1),
  branch: z.string(),
  sha: z.string().min(1),
  attempt: z.number().int().min(1).default(1),
  conclusion: z.enum(['success', 'failure', 'cancelled']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  /** Path of a saved log, relative to the runs file. Absent when logs are fetched from GitHub. */
  logFile: z.string().optional(),
});
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** Key used for per-attempt lookups: `runId:attempt`. */
export const attemptKey = (r: Pick<RunRecord, 'id' | 'attempt'>): string => `${r.id}:${r.attempt}`;

export const ms = (iso: string): number => Date.parse(iso);

export function parseRuns(text: string): RunRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('runs file is not valid JSON');
  }
  const parsed = z.array(RunRecordSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`runs file is invalid: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`);
  }
  return parsed.data;
}

/** True if the same workflow later passed on the same commit: the failure went away without a code change. */
export function passedLater(run: RunRecord, all: readonly RunRecord[]): boolean {
  return all.some(
    (r) =>
      r.conclusion === 'success' &&
      r.workflow === run.workflow &&
      r.sha === run.sha &&
      ms(r.completedAt) > ms(run.completedAt),
  );
}
