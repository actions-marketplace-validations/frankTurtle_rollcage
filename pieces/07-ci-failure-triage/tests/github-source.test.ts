import { GITHUB_API_VERSION, GitHubHttp } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { GitHubRunSource, MAX_LOG_CHARS } from '../src/github-source.ts';
import { readLog } from './helpers.ts';

type Handler = (query: URLSearchParams) => { status?: number; body: unknown; text?: boolean };

/** Fake GitHub: routes by path, records every call, answers with recorded response shapes. */
function fakeGitHub(routes: Record<string, Handler>, headers: Record<string, string> = {}) {
  const calls: { method: string; path: string; query: URLSearchParams; headers: Headers }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.searchParams,
      headers: new Headers(init.headers),
    });
    const route = routes[u.pathname];
    if (!route) return new Response('not found', { status: 404 });
    const r = route(u.searchParams);
    const status = r.status ?? 200;
    const body = r.text ? String(r.body) : JSON.stringify(r.body);
    return new Response(body, { status, headers });
  };
  return { fetchImpl, calls };
}

const R = (p: string) => `/repos/o/r${p}`;
const SHA = 'a'.repeat(40);
const rawRun = (o: Record<string, unknown>) => ({
  id: 1,
  name: 'ci',
  head_branch: 'main',
  head_sha: SHA,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'failure',
  created_at: '2026-03-02T10:00:00Z',
  run_started_at: '2026-03-02T10:00:05Z',
  updated_at: '2026-03-02T10:05:00Z',
  ...o,
});

const make = (routes: Record<string, Handler>, headers?: Record<string, string>) => {
  const fake = fakeGitHub(routes, headers);
  const source = new GitHubRunSource(new GitHubHttp('test-token-not-real', fake.fetchImpl), {
    owner: 'o',
    name: 'r',
  });
  return { source, ...fake };
};

describe('AC-3 GitHub run source through the shared transport', () => {
  const range = {
    since: new Date('2026-03-01T00:00:00Z'),
    until: new Date('2026-03-08T00:00:00Z'),
  };

  it('lists runs, expands earlier attempts of re-run runs, and maps conclusions', async () => {
    const { source, calls } = make({
      [R('/actions/runs')]: () => ({
        body: {
          total_count: 5,
          workflow_runs: [
            rawRun({
              id: 1,
              run_attempt: 2,
              conclusion: 'success',
              updated_at: '2026-03-02T11:00:00Z',
            }),
            rawRun({ id: 2, conclusion: 'timed_out' }),
            rawRun({ id: 3, conclusion: 'cancelled' }),
            rawRun({ id: 4, conclusion: null, status: 'in_progress' }),
            rawRun({ id: 5, conclusion: 'skipped' }),
          ],
        },
      }),
      [R('/actions/runs/1/attempts/1')]: () => ({ body: rawRun({ id: 1, run_attempt: 1 }) }),
    });
    const runs = await source.listRuns(range);
    expect(runs.map((r) => [r.id, r.attempt, r.conclusion])).toEqual([
      [1, 1, 'failure'],
      [1, 2, 'success'],
      [2, 1, 'failure'],
      [3, 1, 'cancelled'],
    ]);
    expect(runs[0]).toMatchObject({
      workflow: 'ci',
      branch: 'main',
      sha: SHA,
      startedAt: '2026-03-02T10:00:05Z',
      completedAt: '2026-03-02T10:05:00Z',
    });
    const list = calls[0];
    expect(list?.query.get('created')).toBe('2026-03-01T00:00:00Z..2026-03-08T00:00:00Z');
    expect(list?.query.get('per_page')).toBe('100');
    expect(list?.headers.get('authorization')).toBe('Bearer test-token-not-real');
    expect(list?.headers.get('x-github-api-version')).toBe(GITHUB_API_VERSION);
  });

  it('fetches job logs for failed jobs only, with a header per job, using GET only', async () => {
    const { source, calls } = make({
      [R('/actions/runs/7/attempts/2/jobs')]: () => ({
        body: {
          total_count: 2,
          jobs: [
            { id: 11, name: 'test', conclusion: 'failure' },
            { id: 12, name: 'lint', conclusion: 'success' },
          ],
        },
      }),
      [R('/actions/jobs/11/logs')]: () => ({ body: readLog('run-9002-disk.log'), text: true }),
    });
    const log = await source.failureLog({ id: 7, attempt: 2 });
    expect(log).toContain('=== job: test ===');
    expect(log).toContain('no space left on device');
    expect(log).not.toContain('lint');
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.map((c) => c.path)).not.toContain(R('/actions/jobs/12/logs'));
  });

  it('keeps only the tail of a very long log', async () => {
    const long = `${'x'.repeat(MAX_LOG_CHARS)}TAIL-MARKER`;
    const { source } = make({
      [R('/actions/runs/7/attempts/1/jobs')]: () => ({
        body: { total_count: 1, jobs: [{ id: 11, name: 'test', conclusion: 'failure' }] },
      }),
      [R('/actions/jobs/11/logs')]: () => ({ body: long, text: true }),
    });
    const log = await source.failureLog({ id: 7, attempt: 1 });
    expect(log.length).toBeLessThanOrEqual(MAX_LOG_CHARS + 100);
    expect(log).toContain('TAIL-MARKER');
  });

  it('returns an empty log when no job failed', async () => {
    const { source } = make({
      [R('/actions/runs/7/attempts/1/jobs')]: () => ({ body: { total_count: 0, jobs: [] } }),
    });
    expect(await source.failureLog({ id: 7, attempt: 1 })).toBe('');
  });

  it('errors with the status and a rate limit hint, never the response body', async () => {
    const { source } = make(
      { [R('/actions/runs')]: () => ({ status: 403, body: 'secret body' }) },
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' },
    );
    const err = await source.listRuns(range).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('403');
    expect((err as Error).message).toContain('rate limit');
    expect((err as Error).message).not.toContain('secret body');
  });
});
