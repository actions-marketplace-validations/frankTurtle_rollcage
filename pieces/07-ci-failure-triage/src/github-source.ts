import type { GitHubHttp } from '@adl/shared';
import type { RunRecord } from './runs.js';

/** Longest log text kept per job. The tail is kept, because failures are at the end. */
export const MAX_LOG_CHARS = 200_000;

interface RawRun {
  id: number;
  name?: string | null;
  head_branch?: string | null;
  head_sha: string;
  run_attempt?: number;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
}
interface RawJob {
  id: number;
  name: string;
  conclusion: string | null;
}

/** Where runs and their logs come from. The CLI loads local files or this GitHub source. */
export interface RunSource {
  listRuns(range: { since: Date; until: Date }): Promise<RunRecord[]>;
  failureLog(run: Pick<RunRecord, 'id' | 'attempt'>): Promise<string>;
}

const CONCLUSION: Record<string, RunRecord['conclusion']> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
  cancelled: 'cancelled',
};
const FAILED_JOB = new Set(['failure', 'timed_out']);

const iso = (d: Date): string => d.toISOString().replace('.000Z', 'Z');

function toRecord(raw: RawRun, attempt: number): RunRecord | null {
  const conclusion = raw.conclusion ? CONCLUSION[raw.conclusion] : undefined;
  if (!conclusion) return null;
  return {
    id: raw.id,
    workflow: raw.name ?? 'workflow',
    branch: raw.head_branch ?? '',
    sha: raw.head_sha,
    attempt,
    conclusion,
    startedAt: raw.run_started_at ?? raw.created_at,
    completedAt: raw.updated_at,
  };
}

/**
 * Reads workflow runs and job logs through the shared GitHub transport. GET requests only.
 * `completedAt` is the run's `updated_at`, which is an approximation of the finish time.
 */
export class GitHubRunSource implements RunSource {
  constructor(
    private readonly http: GitHubHttp,
    private readonly repo: { owner: string; name: string },
  ) {}

  private get base(): string {
    return `/repos/${this.repo.owner}/${this.repo.name}`;
  }

  async listRuns(range: { since: Date; until: Date }): Promise<RunRecord[]> {
    const listed = await this.http.paginate<{ workflow_runs: RawRun[] }, RawRun>(
      `${this.base}/actions/runs`,
      { created: `${iso(range.since)}..${iso(range.until)}` },
      (b) => b.workflow_runs,
      { maxPages: 10 },
    );
    const perRun = await Promise.all(
      listed.map(async (raw) => {
        const attempt = raw.run_attempt ?? 1;
        const earlier = await Promise.all(
          Array.from({ length: attempt - 1 }, (_, i) =>
            this.http.json<RawRun>(`${this.base}/actions/runs/${raw.id}/attempts/${i + 1}`),
          ),
        );
        return [...earlier.map((e, i) => toRecord(e, i + 1)), toRecord(raw, attempt)];
      }),
    );
    return perRun.flat().filter((r): r is RunRecord => r !== null);
  }

  /** The text of every failed job's log for one run attempt, each under a `=== job: name ===` header. */
  async failureLog(run: Pick<RunRecord, 'id' | 'attempt'>): Promise<string> {
    const jobs = await this.http.json<{ jobs: RawJob[] }>(
      `${this.base}/actions/runs/${run.id}/attempts/${run.attempt}/jobs`,
      { per_page: 100 },
    );
    const failed = jobs.jobs.filter((j) => j.conclusion && FAILED_JOB.has(j.conclusion));
    const logs = await Promise.all(
      failed.map(async (job) => {
        const res = await this.http.request('GET', `${this.base}/actions/jobs/${job.id}/logs`);
        const text = await res.text();
        return `=== job: ${job.name} ===\n${text.slice(-MAX_LOG_CHARS)}`;
      }),
    );
    return logs.join('\n');
  }
}
