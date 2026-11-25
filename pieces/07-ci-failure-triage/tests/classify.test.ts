import { describe, expect, it } from 'vitest';
import { classify } from '../src/classify.ts';
import type { Classification } from '../src/classify.ts';
import { DEFAULT_CONFIG } from '../src/config.ts';
import { emptyHistory, loadHistory } from '../src/history.ts';
import { extractSignature, extractTests } from '../src/signature.ts';
import { fixtureText, gh, readLog } from './helpers.ts';

const history = loadHistory(fixtureText('history.json'));

function run(log: string, opts: { passedOnRetry?: boolean; empty?: boolean } = {}): Classification {
  return classify({
    log,
    signature: extractSignature(log),
    tests: extractTests(log),
    passedOnRetry: opts.passedOnRetry ?? false,
    history: opts.empty ? emptyHistory() : history,
    config: DEFAULT_CONFIG,
  });
}

describe('AC-4 classification of the fixture logs', () => {
  it('code regression: a new assertion failure on a test with a stable history', () => {
    const c = run(readLog('run-9001-regression.log'));
    expect(c).toMatchObject({ category: 'regression', confidence: 'high', ruleId: 'test-failure' });
    expect(c.evidence.join('\n')).toContain('tests/cart/discount.test.ts > caps percent at 100');
    expect(c.evidence.join('\n')).toContain('0 of 20');
  });

  it('code regression: a compile error is high confidence', () => {
    expect(run(readLog('run-9007-compile.log'))).toMatchObject({
      category: 'regression',
      confidence: 'high',
      ruleId: 'compile-error',
    });
  });

  it('infrastructure: disk full', () => {
    expect(run(readLog('run-9002-disk.log'))).toMatchObject({
      category: 'infrastructure',
      ruleId: 'disk-full',
      confidence: 'high',
    });
  });

  it('infrastructure: registry rate limit', () => {
    expect(run(readLog('run-9006-ratelimit.log'))).toMatchObject({
      category: 'infrastructure',
      ruleId: 'rate-limit',
    });
  });

  it('dependency: outdated lockfile', () => {
    expect(run(readLog('run-9003-lockfile.log'))).toMatchObject({
      category: 'dependency',
      ruleId: 'lockfile-outdated',
      confidence: 'high',
    });
  });

  it('flaky: passed on retry and a flip history over the threshold', () => {
    const c = run(readLog('run-9004-flaky.log'), { passedOnRetry: true });
    expect(c).toMatchObject({ category: 'flaky', confidence: 'high', ruleId: 'retry-and-history' });
    expect(c.evidence.join('\n')).toContain('passed on a later run of the same commit');
    expect(c.evidence.join('\n')).toContain('5 of 24');
  });

  it('flaky: history alone is medium confidence', () => {
    expect(run(readLog('run-9004-flaky.log'))).toMatchObject({
      category: 'flaky',
      confidence: 'medium',
      ruleId: 'flip-history',
    });
  });

  it('flaky: a retry pass alone is medium confidence, with no history', () => {
    expect(run(readLog('run-9004-flaky.log'), { passedOnRetry: true, empty: true })).toMatchObject({
      category: 'flaky',
      confidence: 'medium',
      ruleId: 'retry-passed',
    });
  });

  it('without a retry pass or history, the same log reads as a regression, medium confidence', () => {
    expect(run(readLog('run-9004-flaky.log'), { empty: true })).toMatchObject({
      category: 'regression',
      confidence: 'medium',
    });
  });
});

describe('AC-4 rule table', () => {
  const cases: [string, string, Classification['category'], string][] = [
    ['runner lost', 'The runner has received a shutdown signal.', 'infrastructure', 'runner-lost'],
    [
      'runner comms',
      'The hosted runner lost communication with the server.',
      'infrastructure',
      'runner-lost',
    ],
    ['heap oom', 'FATAL ERROR: JavaScript heap out of memory', 'infrastructure', 'out-of-memory'],
    [
      'killed 137',
      'Error: Process completed with exit code 137.',
      'infrastructure',
      'out-of-memory',
    ],
    ['network', 'Error: connect ETIMEDOUT 104.16.0.1:443', 'infrastructure', 'network-timeout'],
    ['dns', 'getaddrinfo EAI_AGAIN registry.example.org', 'infrastructure', 'network-timeout'],
    ['api rate limit', 'API rate limit exceeded for installation', 'infrastructure', 'rate-limit'],
    ['npm 404', 'npm ERR! code E404', 'dependency', 'registry-not-found'],
    [
      'npm 404 text',
      'npm ERR! 404 Not Found - GET https://registry.npmjs.org/left-padz',
      'dependency',
      'registry-not-found',
    ],
    ['eresolve', 'npm ERR! code ERESOLVE', 'dependency', 'resolution-conflict'],
    [
      'pnpm resolve',
      'ERR_PNPM_NO_MATCHING_VERSION No matching version found for foo@^9',
      'dependency',
      'resolution-conflict',
    ],
    [
      'pip',
      'ERROR: No matching distribution found for requests==9.9.9',
      'dependency',
      'resolution-conflict',
    ],
    [
      'registry fetch',
      'ERR_PNPM_FETCH_503 GET https://registry.npmjs.org/zod: Service Unavailable',
      'dependency',
      'registry-fetch-failed',
    ],
    [
      'go sum',
      'go: github.com/x/y@v1.2.3: missing go.sum entry',
      'dependency',
      'lockfile-outdated',
    ],
  ];
  it.each(cases)('%s', (_name, line, category, ruleId) => {
    expect(run(gh(line))).toMatchObject({ category, ruleId });
  });

  it('dependency rules win over infrastructure rules, and the order is documented', () => {
    const log = gh(
      'ERR_PNPM_OUTDATED_LOCKFILE Cannot install with "frozen-lockfile"',
      'ENOSPC: no space left on device',
    );
    expect(run(log).category).toBe('dependency');
  });

  it('a retry pass does not override a specific infrastructure cause, but is noted', () => {
    const c = run(readLog('run-9002-disk.log'), { passedOnRetry: true });
    expect(c.category).toBe('infrastructure');
    expect(c.evidence.join('\n')).toContain('passed on a later run of the same commit');
  });

  it('weak network rules are ignored when specific tests failed', () => {
    const log = gh(
      ' FAIL  tests/net.test.ts > rejects with ETIMEDOUT',
      'AssertionError: expected ETIMEDOUT to be ECONNRESET',
    );
    expect(run(log)).toMatchObject({ category: 'regression', ruleId: 'test-failure' });
  });

  it('strong infrastructure rules still apply when tests failed', () => {
    const log = gh(' FAIL  tests/a.test.ts > b', 'ENOSPC: no space left on device');
    expect(run(log).category).toBe('infrastructure');
  });

  it('an unrecognized error is a low confidence regression', () => {
    expect(run(gh('something exploded: status failed'))).toMatchObject({
      category: 'regression',
      confidence: 'low',
      ruleId: 'unclassified-error',
    });
  });

  it('a retry pass with an unrecognized error and no tests is a low confidence flaky call', () => {
    expect(run(gh('something exploded: status failed'), { passedOnRetry: true })).toMatchObject({
      category: 'flaky',
      confidence: 'low',
    });
  });

  it('a log with no error text is unknown', () => {
    expect(run(gh('nothing to see'))).toMatchObject({ category: 'unknown', confidence: 'low' });
  });

  it('a history that is not over the thresholds is described but not used to call it flaky', () => {
    const c = run(gh(' FAIL  tests/ui/toast.test.ts > hides after 3s', 'AssertionError: x'));
    expect(c.category).toBe('regression');
    expect(c.evidence.join('\n')).toContain('2 of 6');
    expect(c.evidence.join('\n')).toContain('too few observations');
  });

  it('every classification carries evidence and says it is a heuristic reading', () => {
    for (const name of ['run-9001-regression.log', 'run-9002-disk.log', 'run-9003-lockfile.log']) {
      const c = run(readLog(name));
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.note).toMatch(/heuristic/i);
    }
  });
});
