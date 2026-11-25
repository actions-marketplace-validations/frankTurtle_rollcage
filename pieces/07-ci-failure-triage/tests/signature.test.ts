import { describe, expect, it } from 'vitest';
import { redact } from '../src/redact.ts';
import { excerpt, extractSignature, extractTests, normalizeLine } from '../src/signature.ts';
import { gh, readLog } from './helpers.ts';

describe('AC-1 normalization', () => {
  it('removes timestamps, paths, ids, hashes and line numbers', () => {
    const raw =
      '2026-03-17T09:14:06.4410091Z \u001b[31merror\u001b[0m in /home/runner/work/shop/shop/src/a.ts:48:23 ' +
      'at 09:14:06 sha 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f run 1234567 took 31ms from 10.1.2.3 ' +
      'id 0b9f8e7d-1c2b-4a3f-9e8d-7c6b5a4f3e2d';
    const out = normalizeLine(raw);
    expect(out).toBe(
      'error in <WORKDIR>/src/a.ts:<L> at <TS> sha <HEX> run <N> took <DUR> from <IP> id <UUID>',
    );
  });

  it('normalizes TypeScript style (line,col) positions and docker step prefixes', () => {
    expect(normalizeLine('src/export/csv.ts(37,18): error TS2345: bad')).toBe(
      'src/export/csv.ts(<L>,<C>): error TS2345: bad',
    );
    expect(normalizeLine('#5 98.20 ENOSPC: no space left on device')).toBe(
      'ENOSPC: no space left on device',
    );
  });

  it('gives the same hash for the same failure on two runs, and a different hash for another', () => {
    const a = extractSignature(readLog('run-9001-regression.log'));
    const shifted = readLog('run-9001-regression.log')
      .replaceAll('2026-03-17T09:14', '2026-04-02T21:55')
      .replaceAll('/home/runner/work/shop/shop', '/home/runner/work/other/other')
      .replaceAll(':48:23', ':51:23');
    const b = extractSignature(shifted);
    expect(b.hash).toBe(a.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{12}$/);
    expect(extractSignature(readLog('run-9004-flaky.log')).hash).not.toBe(a.hash);
  });

  it('keeps the most specific error lines, up to the limit', () => {
    const sig = extractSignature(readLog('run-9001-regression.log'));
    expect(sig.lines).toEqual([
      'FAIL tests/cart/discount.test.ts > caps percent at 100',
      'AssertionError: expected -20 to be 0',
    ]);
    expect(sig.text).toBe(sig.lines.join(' | '));
    const compile = extractSignature(readLog('run-9007-compile.log'), { maxErrorLines: 1 });
    expect(compile.lines).toHaveLength(1);
    expect(compile.lines[0]).toContain('error TS2345');
  });

  it('falls back to generic error lines, then to the exit code line', () => {
    expect(extractSignature(gh('step failed: 2 jobs failed')).lines).toHaveLength(1);
    const exitOnly = extractSignature(gh('##[error]Process completed with exit code 1.'));
    expect(exitOnly.lines).toEqual(['##[error]Process completed with exit code 1.']);
    expect(extractSignature(gh('all good', 'done 0 errors, 0 failed'))).toMatchObject({
      lines: [],
      hash: '',
      text: '',
    });
    expect(extractSignature('')).toMatchObject({ lines: [], hash: '' });
  });
});

describe('failing test ids', () => {
  it('reads Vitest FAIL lines', () => {
    expect(extractTests(readLog('run-9004-flaky.log'))).toEqual([
      'tests/api/orders.test.ts > creates an order',
    ]);
  });

  it('reads Jest, pytest and Go output, sorted and de-duplicated', () => {
    const log = gh(
      '  ● Cart › applies a coupon',
      '  ● Cart › applies a coupon',
      'FAILED tests/test_pay.py::test_refund - AssertionError: nope',
      '--- FAIL: TestParse (0.00s)',
    );
    expect(extractTests(log)).toEqual([
      'Cart > applies a coupon',
      'TestParse',
      'tests/test_pay.py::test_refund',
    ]);
  });

  it('returns nothing for a log with no test failures', () => {
    expect(extractTests(readLog('run-9002-disk.log'))).toEqual([]);
  });
});

describe('redaction and excerpts', () => {
  it('redacts known token shapes', () => {
    const ghToken = `ghp_${'a'.repeat(36)}`;
    const text = [
      'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
      `token ${ghToken}`,
      'Authorization: Bearer abcdefgh12345678',
      `key sk-${'b'.repeat(30)}`,
      'DB_PASSWORD: hunter2',
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
    ].join('\n');
    const out = redact(text);
    for (const secret of [
      'AKIAIOSFODNN7EXAMPLE',
      ghToken,
      'abcdefgh12345678',
      'hunter2',
      'abc\n',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED');
  });

  it('builds an excerpt from error lines with timestamps stripped', () => {
    const lines = excerpt(readLog('run-9001-regression.log'), 5);
    expect(lines[0]).toBe('FAIL  tests/cart/discount.test.ts > caps percent at 100');
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(excerpt(gh('nothing wrong here'), 5)).toEqual([]);
  });
});
