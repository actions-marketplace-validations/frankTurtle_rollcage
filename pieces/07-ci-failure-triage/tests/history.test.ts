import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.ts';
import {
  MAX_OBSERVATIONS,
  emptyHistory,
  flipStats,
  isFlaky,
  loadHistory,
  recordRuns,
  serializeHistory,
} from '../src/history.ts';
import type { RunRecord } from '../src/runs.ts';
import { fixtureText } from './helpers.ts';

const ORDERS = 'tests/api/orders.test.ts > creates an order';
const run = (o: Partial<RunRecord> & Pick<RunRecord, 'id' | 'conclusion'>): RunRecord => ({
  workflow: 'ci',
  branch: 'main',
  sha: 'a'.repeat(40),
  attempt: 1,
  startedAt: '2026-03-20T10:00:00Z',
  completedAt: '2026-03-20T10:05:00Z',
  ...o,
});

describe('AC-5 flip-rate history', () => {
  it('computes the flip rate as commits with both outcomes over observed commits', () => {
    const history = loadHistory(fixtureText('history.json'));
    const stats = flipStats(history, ORDERS);
    expect(stats).toMatchObject({ observedCommits: 24, flipCommits: 5 });
    expect(stats.flipRate).toBeCloseTo(5 / 24, 5);
    expect(flipStats(history, 'no such test')).toEqual({
      observedCommits: 0,
      flipCommits: 0,
      flipRate: 0,
    });
  });

  it('marks a test flaky only when all three thresholds are met', () => {
    const history = loadHistory(fixtureText('history.json'));
    const cfg = DEFAULT_CONFIG.flaky;
    expect(isFlaky(flipStats(history, ORDERS), cfg)).toBe(true);
    expect(isFlaky(flipStats(history, 'tests/ui/toast.test.ts > hides after 3s'), cfg)).toBe(false);
    expect(
      isFlaky(flipStats(history, 'tests/cart/discount.test.ts > caps percent at 100'), cfg),
    ).toBe(false);
    expect(isFlaky({ observedCommits: 40, flipCommits: 3, flipRate: 0.075 }, cfg)).toBe(false);
    expect(isFlaky({ observedCommits: 12, flipCommits: 2, flipRate: 0.17 }, cfg)).toBe(false);
  });

  it('records failures and, for passing runs, passes for tests already tracked', () => {
    const failing = run({ id: 1, conclusion: 'failure' });
    const h1 = recordRuns(emptyHistory(), [failing], new Map([['1:1', ['t > a', 't > b']]]));
    expect(Object.keys(h1.tests).sort()).toEqual(['t > a', 't > b']);
    expect(h1.tests['t > a']?.observations).toEqual([
      { runId: 1, attempt: 1, sha: failing.sha, outcome: 'fail', at: failing.completedAt },
    ]);

    const passing = run({
      id: 2,
      conclusion: 'success',
      sha: 'b'.repeat(40),
      completedAt: '2026-03-20T11:00:00Z',
    });
    const h2 = recordRuns(h1, [passing], new Map());
    expect(h2.tests['t > a']?.observations.map((o) => o.outcome)).toEqual(['fail', 'pass']);
    expect(flipStats(h2, 't > a')).toMatchObject({ observedCommits: 2, flipCommits: 0 });

    const sameSha = run({
      id: 1,
      attempt: 2,
      conclusion: 'success',
      completedAt: '2026-03-20T10:30:00Z',
    });
    const h3 = recordRuns(h2, [sameSha], new Map());
    expect(flipStats(h3, 't > a')).toMatchObject({
      observedCommits: 2,
      flipCommits: 1,
      flipRate: 0.5,
    });
  });

  it('does not create tests from passing runs, and ignores other workflows and cancelled runs', () => {
    const h = recordRuns(
      emptyHistory(),
      [run({ id: 3, conclusion: 'success' }), run({ id: 4, conclusion: 'cancelled' })],
      new Map(),
    );
    expect(h.tests).toEqual({});
    const base = recordRuns(
      emptyHistory(),
      [run({ id: 1, conclusion: 'failure' })],
      new Map([['1:1', ['x']]]),
    );
    const other = recordRuns(
      base,
      [run({ id: 5, workflow: 'lint', conclusion: 'success' })],
      new Map(),
    );
    expect(other.tests['x']?.observations).toHaveLength(1);
    const cancelled = recordRuns(base, [run({ id: 6, conclusion: 'cancelled' })], new Map());
    expect(cancelled.tests['x']?.observations).toHaveLength(1);
  });

  it('is idempotent: recording the same runs twice changes nothing', () => {
    const runs = [
      run({ id: 1, conclusion: 'failure' }),
      run({ id: 2, conclusion: 'success', sha: 'b'.repeat(40) }),
    ];
    const failed = new Map([['1:1', ['x']]]);
    const once = recordRuns(emptyHistory(), runs, failed);
    const twice = recordRuns(once, runs, failed);
    expect(serializeHistory(twice)).toBe(serializeHistory(once));
  });

  it('does not mutate the history it is given', () => {
    const before = emptyHistory();
    recordRuns(before, [run({ id: 1, conclusion: 'failure' })], new Map([['1:1', ['x']]]));
    expect(before.tests).toEqual({});
  });

  it('keeps only the most recent observations per test', () => {
    let h = recordRuns(
      emptyHistory(),
      [run({ id: 0, conclusion: 'failure' })],
      new Map([['0:1', ['x']]]),
    );
    const passes = Array.from({ length: MAX_OBSERVATIONS + 20 }, (_, i) =>
      run({
        id: i + 1,
        conclusion: 'success',
        sha: i.toString(16).padStart(40, '0'),
        completedAt: new Date(Date.UTC(2026, 2, 21) + i * 60_000).toISOString(),
      }),
    );
    h = recordRuns(h, passes, new Map());
    expect(h.tests['x']?.observations).toHaveLength(MAX_OBSERVATIONS);
    expect(h.tests['x']?.observations[0]?.outcome).toBe('pass');
  });

  it('serializes with sorted keys and a trailing newline', () => {
    const h = recordRuns(
      emptyHistory(),
      [run({ id: 1, conclusion: 'failure' })],
      new Map([['1:1', ['b', 'a']]]),
    );
    const text = serializeHistory(h);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"b"'));
  });

  it('loads empty text as an empty history and rejects bad files with a clear message', () => {
    expect(loadHistory(undefined)).toEqual(emptyHistory());
    expect(loadHistory('  ')).toEqual(emptyHistory());
    expect(() => loadHistory('{not json')).toThrow(/history file is not valid JSON/);
    expect(() => loadHistory('{"version":2,"tests":{}}')).toThrow(/history file is invalid/);
    expect(() =>
      loadHistory(
        '{"version":1,"tests":{"x":{"workflow":"ci","observations":[{"outcome":"maybe"}]}}}',
      ),
    ).toThrow(/history file is invalid/);
  });

  it('reads thresholds from config and rejects out of range values', () => {
    const cfg = loadConfig('flaky:\n  flip_rate_threshold: 0.3\nmin_samples: 2\n');
    expect(cfg.flaky.flip_rate_threshold).toBe(0.3);
    expect(cfg.flaky.min_observations).toBe(10);
    expect(cfg.min_samples).toBe(2);
    expect(loadConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(() => loadConfig('flaky:\n  flip_rate_threshold: 4\n')).toThrow();
  });
});
