import { sha256Hex } from '@adl/shared';
import { redactSecrets as redact } from '@adl/shared';

// Built from a string so the escape character is explicit and the control-character lint rule stays on.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const GH_TIMESTAMP_PREFIX = /^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/;
const MAX_LINE = 200;

/** A raw log line without ANSI codes and without the Actions timestamp prefix. */
export const cleanLine = (raw: string): string =>
  raw.replace(ANSI, '').replace(GH_TIMESTAMP_PREFIX, '').trimEnd();

const hasDigitAndLetter = (s: string): boolean => /\d/.test(s) && /[a-f]/i.test(s);

/**
 * Reduce a log line to the part that stays the same from run to run: timestamps, paths, ids,
 * hashes, durations, addresses, long numbers and line numbers are replaced with placeholders.
 */
export function normalizeLine(raw: string): string {
  return redact(cleanLine(raw))
    .replace(/^(?:#\d+\s+)?(?:\d+\.\d+\s+)?/, '')
    .replace(/\b\d{4}-\d\d-\d\d[T ][\d:.]+Z?/g, '<TS>')
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '<TS>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
    .replace(/\/home\/runner\/work\/[^/\s]+\/[^/\s]+/g, '<WORKDIR>')
    .replace(/\/__w\/[^/\s]+\/[^/\s]+/g, '<WORKDIR>')
    .replace(/\/(?:home\/runner|Users\/[^/\s]+|home\/[^/\s]+)(?=\/|\b)/g, '<HOME>')
    .replace(/\/tmp\/[^\s/]+/g, '<TMP>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<IP>')
    .replace(/(\.\w+):\d+(?::\d+)?/g, '$1:<L>')
    .replace(/\((\d+),(\d+)\)/g, '(<L>,<C>)')
    .replace(/\bline \d+/gi, 'line <N>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|sec|seconds|s)\b/g, '<DUR>')
    .replace(/\b[0-9a-f]{7,64}\b/gi, (m) => (hasDigitAndLetter(m) ? '<HEX>' : m))
    .replace(/#\d+\b/g, '#<N>')
    .replace(/\b\d+(?:\.\d+)+\b/g, '<N>')
    .replace(/\b\d{4,}\b/g, '<N>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LINE);
}

/** Lines that name the failure: error types, error codes, FAIL markers. */
const SPECIFIC =
  /\b[A-Za-z]*(?:Error|Exception)\b|\berror TS\d+|\bERR[_!]\w*|\bE(?:NOSPC|CONNRESET|TIMEDOUT|AI_AGAIN|NOTFOUND|404|RESOLVE)\b|\bFAIL\b|\bERROR\b|\bFATAL\b|\bpanic:|\bfatal:|\bKilled\b|no space left|toomanyrequests|out of memory|rate limit|shutdown signal|lost communication/i;
/** Weaker lines: any mention of error or failure, minus summary counts like "0 failed". */
const GENERIC = /error|fail/i;
const ZERO_COUNT = /\b0 (?:errors?|failed|failures?)\b/i;
/** The line GitHub adds when a step exits non-zero. Only used when nothing else is found. */
const EXIT_LINE = /^##\[error\]Process completed with exit code \d+/;

interface Candidates {
  lines: string[];
  tier: 'specific' | 'generic' | 'exit' | 'none';
}

function candidates(log: string): Candidates {
  const lines = log.split('\n').map(cleanLine).filter(Boolean);
  const specific = lines.filter(
    (l) => !EXIT_LINE.test(l) && SPECIFIC.test(l) && !ZERO_COUNT.test(l),
  );
  if (specific.length) return { lines: specific, tier: 'specific' };
  const generic = lines.filter((l) => !EXIT_LINE.test(l) && GENERIC.test(l) && !ZERO_COUNT.test(l));
  if (generic.length) return { lines: generic, tier: 'generic' };
  const exit = lines.filter((l) => EXIT_LINE.test(l));
  return exit.length ? { lines: exit, tier: 'exit' } : { lines: [], tier: 'none' };
}

export interface Signature {
  /** Distinct normalized error lines, most specific first. */
  lines: string[];
  text: string;
  /** First 12 hex characters of the SHA-256 of `text`. Empty when no error text was found. */
  hash: string;
}

export function extractSignature(log: string, opts: { maxErrorLines?: number } = {}): Signature {
  const max = opts.maxErrorLines ?? 3;
  const lines = [...new Set(candidates(log).lines.map(normalizeLine))].slice(0, max);
  const text = lines.join(' | ');
  return { lines, text, hash: text ? sha256Hex(text).slice(0, 12) : '' };
}

/** Patterns for failing test ids. Each returns the id from one cleaned line, or null. */
export const TEST_PATTERNS: ((line: string) => string | null)[] = [
  // Vitest: FAIL  tests/a.test.ts > suite > name
  (l) =>
    /^FAIL\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+>\s+(.+)$/.exec(l)?.slice(1).join(' > ') ?? null,
  // Jest: ● Suite › test name
  (l) => /^●\s+(.+?)\s+›\s+(.+)$/.exec(l)?.slice(1).join(' > ') ?? null,
  // pytest: FAILED tests/test_x.py::test_y - message
  (l) => /^FAILED\s+(\S+::\S+)/.exec(l)?.[1] ?? null,
  // Go: --- FAIL: TestName (0.00s)
  (l) => /^--- FAIL:\s+(\S+)/.exec(l)?.[1] ?? null,
];

export function extractTests(log: string): string[] {
  const ids = new Set<string>();
  for (const raw of log.split('\n')) {
    const line = cleanLine(raw).trim();
    for (const pattern of TEST_PATTERNS) {
      const id = pattern(line);
      if (id) ids.add(id.trim());
    }
  }
  return [...ids].sort();
}

/** The first error lines as they appear in the log (timestamps stripped), with secrets redacted. */
export function excerpt(log: string, count: number): string[] {
  return candidates(log)
    .lines.slice(0, count)
    .map((l) => redact(l.trim()).slice(0, MAX_LINE));
}
