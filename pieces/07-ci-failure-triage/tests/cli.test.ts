import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import type { CliDeps } from '../src/cli.ts';
import { FIXTURES, LLM_FIXTURES, readLog, tmp } from './helpers.ts';

function deps(extra: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const d: CliDeps = {
    env: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...extra,
  };
  return { d, out, err, text: () => out.join('\n') };
}

const f = (name: string) => join(FIXTURES, name);

interface Report {
  source: string;
  runs: {
    id: string;
    category: string;
    confidence: string;
    summarySource: string;
    summaryReason?: string;
    passedOnRetry?: boolean;
    tests: string[];
  }[];
  skipped: { id: string; reason: string }[];
  proposal: { tests: { id: string }[] } | null;
}
const readReport = (dir: string): Report =>
  JSON.parse(readFileSync(join(dir, 'triage.json'), 'utf8')) as Report;

describe('AC-2 local runs and logs, offline', () => {
  it('classifies the fixture failed runs and writes the four outputs', async () => {
    const dir = tmp();
    const t = deps({
      fetchImpl: () => {
        throw new Error('network must not be used');
      },
    });
    const code = await runCli(
      [
        'triage',
        ...['--runs', f('runs.json'), '--history', f('history.json')],
        ...['--quarantine', f('quarantine.json'), '--llm', 'none', '--out', dir],
      ],
      t.d,
    );
    expect(code).toBe(0);
    for (const name of ['triage.json', 'triage.md', 'quarantine.patch', 'quarantine-pr-body.md']) {
      expect(existsSync(join(dir, name))).toBe(true);
    }
    const report = readReport(dir);
    expect(Object.fromEntries(report.runs.map((r) => [r.id, r.category]))).toEqual({
      '9001#1': 'regression',
      '9002#1': 'infrastructure',
      '9003#1': 'dependency',
      '9004#1': 'flaky',
      '9006#1': 'infrastructure',
      '9007#1': 'regression',
    });
    expect(report.runs.find((r) => r.id === '9004#1')?.passedOnRetry).toBe(true);
    expect(report.runs.every((r) => r.summarySource === 'fallback')).toBe(true);
    expect(report.runs[0]?.summaryReason).toMatch(/LLM disabled/);
    expect(report.skipped.length).toBeGreaterThan(0);
    expect(report.skipped[0]?.reason).toMatch(/no log/);
    expect(report.proposal?.tests.map((x) => x.id)).toEqual([
      'tests/api/orders.test.ts > creates an order',
    ]);
    const md = readFileSync(join(dir, 'triage.md'), 'utf8');
    expect(md).toMatch(/heuristic/i);
    expect(md).toContain('gh pr create');
    expect(t.text()).toContain('9004');
  });

  it('classifies local log files with no run records', async () => {
    const dir = tmp();
    const t = deps();
    const log = join(FIXTURES, 'logs', 'run-9003-lockfile.log');
    const code = await runCli(['triage', '--log', log, '--llm', 'none', '--out', dir], t.d);
    expect(code).toBe(0);
    const report = readReport(dir);
    expect(report.source).toBe('logs');
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]).toMatchObject({ category: 'dependency' });
    expect(report.proposal).toBeNull();
    expect(existsSync(join(dir, 'quarantine.patch'))).toBe(false);
  });

  it('prints to the terminal when --out is not given, and writes nothing', async () => {
    const t = deps();
    const code = await runCli(
      ['triage', '--log', f('logs/run-9001-regression.log'), '--llm', 'none'],
      t.d,
    );
    expect(code).toBe(0);
    expect(t.text()).toMatch(/regression/);
  });

  it('records history only with --update-history, and twice gives the same file', async () => {
    const dir = tmp();
    const history = join(dir, 'history.json');
    copyFileSync(f('history.json'), history);
    const before = readFileSync(history, 'utf8');
    const base = ['triage', '--runs', f('runs.json'), '--history', history, '--llm', 'none'];
    await runCli(base, deps().d);
    expect(readFileSync(history, 'utf8')).toBe(before);
    await runCli([...base, '--update-history'], deps().d);
    const once = readFileSync(history, 'utf8');
    expect(once).not.toBe(before);
    expect(once).toContain('"outcome": "fail"');
    await runCli([...base, '--update-history'], deps().d);
    expect(readFileSync(history, 'utf8')).toBe(once);
  });

  it('uses recorded model replies with --llm replay', async () => {
    const dir = tmp();
    const t = deps();
    const code = await runCli(
      [
        'triage',
        ...['--runs', f('runs.json'), '--history', f('history.json')],
        ...['--llm', 'replay', '--llm-fixtures', LLM_FIXTURES, '--out', dir],
      ],
      t.d,
    );
    expect(code).toBe(0);
    const report = readReport(dir);
    expect(report.runs.map((r) => r.summarySource)).toEqual(Array(6).fill('model'));
  });

  it('falls back and says why when a replay fixture is missing', async () => {
    const dir = tmp();
    const empty = join(dir, 'none');
    mkdirSync(empty);
    const code = await runCli(
      [
        'triage',
        '--log',
        f('logs/run-9002-disk.log'),
        '--llm',
        'replay',
        '--llm-fixtures',
        empty,
        '--out',
        dir,
      ],
      deps().d,
    );
    expect(code).toBe(0);
    expect(readReport(dir).runs[0]).toMatchObject({ summarySource: 'fallback' });
  });

  it('reads thresholds from --config', async () => {
    const dir = tmp();
    const cfg = join(dir, 'triage.yml');
    writeFileSync(cfg, 'flaky:\n  min_observations: 100\n');
    await runCli(
      [
        'triage',
        '--runs',
        f('runs.json'),
        '--history',
        f('history.json'),
        '--config',
        cfg,
        '--llm',
        'none',
        '--out',
        dir,
      ],
      deps().d,
    );
    const report = readReport(dir);
    expect(report.proposal).toBeNull();
    expect(report.runs.find((r) => r.id === '9004#1')?.category).toBe('flaky');
  });
});

describe('AC-3 GitHub mode through a fake fetch', () => {
  it('lists runs and downloads failed job logs with GET requests only', async () => {
    const calls: { method: string; path: string }[] = [];
    const fetchImpl = async (url: string, init: RequestInit) => {
      const u = new URL(url);
      calls.push({ method: init.method ?? 'GET', path: u.pathname });
      const json = (b: unknown) => new Response(JSON.stringify(b));
      if (u.pathname === '/repos/o/r/actions/runs') {
        return json({
          workflow_runs: [
            {
              id: 5,
              name: 'ci',
              head_branch: 'main',
              head_sha: 'a'.repeat(40),
              run_attempt: 1,
              conclusion: 'failure',
              created_at: '2026-03-02T10:00:00Z',
              updated_at: '2026-03-02T10:05:00Z',
            },
          ],
        });
      }
      if (u.pathname === '/repos/o/r/actions/runs/5/attempts/1/jobs') {
        return json({ jobs: [{ id: 50, name: 'test', conclusion: 'failure' }] });
      }
      if (u.pathname === '/repos/o/r/actions/jobs/50/logs') {
        return new Response(readLog('run-9003-lockfile.log'));
      }
      return new Response('nope', { status: 404 });
    };
    const dir = tmp();
    const t = deps({ env: { GITHUB_TOKEN: 'test-token-not-real' }, fetchImpl });
    const code = await runCli(
      [
        'triage',
        '--repo',
        'o/r',
        '--since',
        '2026-03-01',
        '--until',
        '2026-03-08',
        '--llm',
        'none',
        '--out',
        dir,
      ],
      t.d,
    );
    expect(code).toBe(0);
    expect(readReport(dir).runs[0]).toMatchObject({ id: '5#1', category: 'dependency' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
  });

  it('skips a run whose logs are gone and says so', async () => {
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      if (u.pathname === '/repos/o/r/actions/runs') {
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 5,
                name: 'ci',
                head_branch: 'main',
                head_sha: 'a'.repeat(40),
                run_attempt: 1,
                conclusion: 'failure',
                created_at: '2026-03-02T10:00:00Z',
                updated_at: '2026-03-02T10:05:00Z',
              },
            ],
          }),
        );
      }
      return new Response('gone', { status: 410 });
    };
    const dir = tmp();
    const code = await runCli(
      [
        'triage',
        '--repo',
        'o/r',
        '--since',
        '2026-03-01',
        '--until',
        '2026-03-08',
        '--llm',
        'none',
        '--out',
        dir,
      ],
      deps({ env: { GITHUB_TOKEN: 'test-token-not-real' }, fetchImpl }).d,
    );
    expect(code).toBe(0);
    const report = readReport(dir);
    expect(report.runs).toHaveLength(0);
    expect(report.skipped[0]?.reason).toMatch(/log unavailable/);
  });

  it('needs a token', async () => {
    const t = deps();
    const code = await runCli(
      ['triage', '--repo', 'o/r', '--since', '2026-03-01', '--until', '2026-03-08'],
      t.d,
    );
    expect(code).toBe(2);
    expect(t.err.join('\n')).toMatch(/GITHUB_TOKEN/);
  });
});

describe('AC-6 the CLI never opens a pull request', () => {
  it('prints the maintainer commands as text and makes no write calls', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(init.method ?? 'GET');
      return new Response('{}');
    };
    const dir = tmp();
    const t = deps({ fetchImpl });
    await runCli(
      [
        'triage',
        '--runs',
        f('runs.json'),
        '--history',
        f('history.json'),
        '--quarantine',
        f('quarantine.json'),
        '--llm',
        'none',
        '--out',
        dir,
      ],
      t.d,
    );
    expect(calls).toEqual([]);
    expect(t.text()).toContain('git apply');
    expect(t.text()).toContain('gh pr create');
  });
});

describe('AC-8 metrics command', () => {
  it('prints before and after with the given label', async () => {
    const t = deps();
    const code = await runCli(
      [
        'metrics',
        '--runs',
        f('runs.json'),
        '--since',
        '2026-02-02',
        '--until',
        '2026-03-30',
        '--compare-at',
        '2026-03-02',
        '--label',
        'fixture data',
      ],
      t.d,
    );
    expect(code).toBe(0);
    expect(t.text()).toContain('Time to green');
    expect(t.text()).toContain('fixture data');
    expect(t.text()).toContain('2026-03-02 to 2026-03-29');
  });

  it('defaults the range to the data and runs without --compare-at', async () => {
    const t = deps();
    expect(await runCli(['metrics', '--runs', f('runs.json')], t.d)).toBe(0);
    expect(t.text()).toContain('Time to green');
    expect(t.text()).not.toContain('Before');
  });
});

describe('usage', () => {
  it.each([
    [[], 2],
    [['bogus'], 2],
    [['triage'], 2],
    [['triage', '--runs', 'a', '--repo', 'o/r'], 2],
    [['triage', '--runs', f('runs.json'), '--llm', 'wat'], 2],
    [['triage', '--repo', 'bad'], 2],
    [['metrics'], 2],
    [['metrics', '--runs', f('runs.json'), '--compare-at', 'yesterday'], 2],
    [['triage', '--runs', '/no/such/file.json'], 2],
    [['triage', '--runs', f('runs.json'), '--history', f('runs.json')], 2],
    [['--help'], 0],
  ] as [string[], number][])('%j exits %i', async (args, expected) => {
    const t = deps();
    expect(await runCli(args, t.d)).toBe(expected);
    expect(t.out.join('\n') + t.err.join('\n')).toMatch(/Usage|usage|error/i);
  });
});
