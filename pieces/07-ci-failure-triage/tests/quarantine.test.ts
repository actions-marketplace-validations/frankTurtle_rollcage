import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { loadHistory, emptyHistory } from '../src/history.ts';
import { loadQuarantine, maintainerCommands, proposeQuarantine } from '../src/quarantine.ts';
import { FIXTURES, fixtureText, tmp } from './helpers.ts';

const ORDERS = 'tests/api/orders.test.ts > creates an order';
const history = loadHistory(fixtureText('history.json'));
const quarantineText = fixtureText('quarantine.json');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' });

describe('AC-6 quarantine proposal', () => {
  it('proposes exactly the test over the thresholds', () => {
    const p = proposeQuarantine({
      history,
      quarantine: loadQuarantine(quarantineText),
      quarantineText,
      path: 'quarantine.json',
      config: DEFAULT_CONFIG.flaky,
    });
    expect(p?.tests.map((t) => t.id)).toEqual([ORDERS]);
    expect(p?.tests[0]).toMatchObject({ observedCommits: 24, flipCommits: 5 });
    const updated = JSON.parse(p?.newText ?? '{}') as { tests: { id: string; owner: string }[] };
    expect(updated.tests.map((t) => t.id)).toEqual([
      'tests/legacy/sync.test.ts > retries on conflict',
      ORDERS,
    ]);
    expect(updated.tests[1]?.owner).toBe('');
  });

  it('writes a patch that git accepts and that produces the proposed file', () => {
    const dir = tmp();
    git(dir, 'init', '-q');
    copyFileSync(join(FIXTURES, 'quarantine.json'), join(dir, 'quarantine.json'));
    const p = proposeQuarantine({
      history,
      quarantine: loadQuarantine(quarantineText),
      quarantineText,
      path: 'quarantine.json',
      config: DEFAULT_CONFIG.flaky,
    });
    writeFileSync(join(dir, 'q.patch'), p?.patch ?? '');
    git(dir, 'apply', '--check', 'q.patch');
    git(dir, 'apply', 'q.patch');
    expect(readFileSync(join(dir, 'quarantine.json'), 'utf8')).toBe(p?.newText);
  });

  it('writes a patch that creates the file when there is no quarantine list yet', () => {
    const dir = tmp();
    git(dir, 'init', '-q');
    const p = proposeQuarantine({
      history,
      quarantine: loadQuarantine(undefined),
      quarantineText: undefined,
      path: 'quarantine.json',
      config: DEFAULT_CONFIG.flaky,
    });
    expect(p?.patch).toContain('new file mode 100644');
    writeFileSync(join(dir, 'q.patch'), p?.patch ?? '');
    git(dir, 'apply', '--check', 'q.patch');
    git(dir, 'apply', 'q.patch');
    expect(JSON.parse(readFileSync(join(dir, 'quarantine.json'), 'utf8'))).toMatchObject({
      version: 1,
    });
  });

  it('does not propose tests with too little history, stable tests, or tests already listed', () => {
    const base = {
      quarantine: loadQuarantine(quarantineText),
      quarantineText,
      path: 'quarantine.json',
      config: DEFAULT_CONFIG.flaky,
    };
    expect(proposeQuarantine({ ...base, history: emptyHistory() })).toBeNull();
    const already = JSON.stringify({
      version: 1,
      tests: [{ id: ORDERS, reason: 'x', owner: 'me' }],
    });
    expect(
      proposeQuarantine({
        ...base,
        history,
        quarantine: loadQuarantine(already),
        quarantineText: already,
      }),
    ).toBeNull();
    const strict = { ...DEFAULT_CONFIG.flaky, min_observations: 30 };
    expect(proposeQuarantine({ ...base, history, config: strict })).toBeNull();
  });

  it('writes a PR body that asks for human review and states its assumptions', () => {
    const p = proposeQuarantine({
      history,
      quarantine: loadQuarantine(quarantineText),
      quarantineText,
      path: 'quarantine.json',
      config: DEFAULT_CONFIG.flaky,
    });
    const body = p?.prBody ?? '';
    expect(body).toContain(ORDERS);
    expect(body).toContain('5 of 24');
    expect(body).toMatch(/needs human review/i);
    expect(body).toMatch(/owner/i);
    expect(body).toMatch(/assum/i);
    expect(body).not.toMatch(/auto-?merge/i);
    expect(p?.patch).not.toContain('AKIA');
  });

  it('prints the commands a maintainer would run, and never runs them', () => {
    const text = maintainerCommands(
      'out/quarantine.patch',
      'out/quarantine-pr-body.md',
      'quarantine.json',
    );
    expect(text).toContain('git apply out/quarantine.patch');
    expect(text).toContain('gh pr create');
    expect(text).toContain('--body-file out/quarantine-pr-body.md');
    expect(text).not.toMatch(/--auto|gh pr merge/);
  });

  it('rejects a malformed quarantine file', () => {
    expect(() => loadQuarantine('{"version":1,"tests":[{"id":5}]}')).toThrow(
      /quarantine file is invalid/,
    );
    expect(() => loadQuarantine('nope')).toThrow(/quarantine file is not valid JSON/);
  });
});
