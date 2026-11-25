import type { TriageConfig } from './config.js';
import { flipStats, isFlaky } from './history.js';
import type { FlipStats, History } from './history.js';
import { redactSecrets } from '@adl/shared';
import { cleanLine } from './signature.js';
import type { Signature } from './signature.js';

export type Category = 'regression' | 'flaky' | 'infrastructure' | 'dependency' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';

export interface Classification {
  category: Category;
  confidence: Confidence;
  /** Id of the rule that decided the category. */
  ruleId: string;
  /** The lines and numbers behind the decision, so a reader can check it. */
  evidence: string[];
  note: string;
}

export const NOTE = 'Heuristic reading of the log and run history, not a confirmed root cause.';

interface Rule {
  id: string;
  category: 'dependency' | 'infrastructure';
  pattern: RegExp;
  /**
   * Weak rules match text that tests also print on purpose (a timeout, a connection reset), so
   * they are ignored when specific tests failed.
   */
  weak?: boolean;
  description: string;
}

/**
 * Ordered rules. Dependency rules come first, then infrastructure rules; the first rule that
 * matches decides the category. To add a rule, add an entry here and a fixture log and test.
 */
export const RULES: Rule[] = [
  {
    id: 'lockfile-outdated',
    category: 'dependency',
    pattern:
      /ERR_PNPM_OUTDATED_LOCKFILE|lockfile.*(?:not up to date|out of date|needs to be updated)|npm ci.*package-lock\.json.*(?:in sync|out of sync)|missing go\.sum entry|Cargo\.lock.*needs to be updated/i,
    description: 'lockfile does not match the manifest',
  },
  {
    id: 'resolution-conflict',
    category: 'dependency',
    pattern:
      /\bERESOLVE\b|ERR_PNPM_NO_MATCHING_VERSION|ERR_PNPM_PEER_DEP_ISSUES|No matching distribution found|ResolutionImpossible|Could not resolve dependenc|No matching version found|npm ERR! code ETARGET/i,
    description: 'dependency versions cannot be resolved',
  },
  {
    id: 'registry-not-found',
    category: 'dependency',
    pattern:
      /npm ERR! (?:code E404|404 )|ERR_PNPM_FETCH_404|ERR_PNPM_REGISTRIES_MISMATCH|404 Not Found - GET https?:\/\/registry\./i,
    description: 'package or version not found in the registry',
  },
  {
    id: 'registry-fetch-failed',
    category: 'dependency',
    pattern:
      /ERR_PNPM_FETCH_\d+|npm ERR! (?:network|code E(?:CONNRESET|TIMEDOUT|503|502|500))|registry\.(?:npmjs\.org|yarnpkg\.com|npmmirror\.com)\S*.*(?:ECONN|ETIMEDOUT|50[023])|pypi\.org.*(?:timed out|Connection (?:reset|broken))/i,
    description: 'the package registry did not answer',
  },
  {
    id: 'disk-full',
    category: 'infrastructure',
    pattern: /ENOSPC|no space left on device/i,
    description: 'runner disk is full',
  },
  {
    id: 'out-of-memory',
    category: 'infrastructure',
    pattern:
      /JavaScript heap out of memory|\bOOMKilled\b|Out of memory: Killed|exit code 137|\bCannot allocate memory\b|\bKilled\b$/i,
    description: 'process ran out of memory',
  },
  {
    id: 'runner-lost',
    category: 'infrastructure',
    pattern:
      /runner has received a shutdown signal|lost communication with the server|runner.*(?:was|has been) (?:terminated|cancelled)|The operation was canceled\.|Unable to download.*actions?\//i,
    description: 'the runner went away',
  },
  {
    id: 'rate-limit',
    category: 'infrastructure',
    pattern: /rate limit|toomanyrequests|429 Too Many Requests|HTTP 429|secondary rate/i,
    description: 'a service rate limit was hit',
  },
  {
    id: 'network-timeout',
    category: 'infrastructure',
    weak: true,
    pattern:
      /\bETIMEDOUT\b|\bECONNRESET\b|\bEAI_AGAIN\b|socket hang up|Temporary failure in name resolution|TLS handshake timeout|connection reset by peer/i,
    description: 'network error',
  },
  {
    id: 'upstream-5xx',
    category: 'infrastructure',
    weak: true,
    pattern:
      /\b50[0234] (?:Bad Gateway|Service Unavailable|Gateway Time-?out|Internal Server Error)\b/i,
    description: 'upstream service error',
  },
];

const COMPILE =
  /error TS\d+|SyntaxError|error\[E\d{4}\]|compilation failed|Cannot find module|Module not found|cannot find package|undefined: \w+|build failed/i;

export interface ClassifyInput {
  log: string;
  signature: Signature;
  tests: string[];
  /** The same commit passed the same workflow later. */
  passedOnRetry: boolean;
  history: History;
  config: TriageConfig;
}

const RETRY_EVIDENCE = 'the same workflow passed on a later run of the same commit';

function firstMatch(rule: Rule, log: string): string | undefined {
  return log
    .split('\n')
    .map(cleanLine)
    .find((l) => rule.pattern.test(l));
}

const pct = (n: number): string => (Math.round(n * 100) / 100).toString();

function describeStats(
  id: string,
  s: FlipStats,
  flaky: boolean,
  cfg: TriageConfig['flaky'],
): string {
  const base = `${id}: failed and passed on the same commit in ${s.flipCommits} of ${s.observedCommits} observed commits (${pct(s.flipRate)})`;
  if (flaky) return `${base}, over the flaky thresholds`;
  if (s.observedCommits < cfg.min_observations) {
    return `${base}; too few observations to judge (needs ${cfg.min_observations})`;
  }
  return `${base}; under the flaky thresholds`;
}

export function classify(input: ClassifyInput): Classification {
  const { log, signature, tests, passedOnRetry, history, config } = input;
  const result = (
    category: Category,
    confidence: Confidence,
    ruleId: string,
    evidence: string[],
  ): Classification => ({ category, confidence, ruleId, evidence, note: NOTE });
  const retryNote = passedOnRetry ? [RETRY_EVIDENCE] : [];

  for (const rule of RULES) {
    if (rule.weak && tests.length > 0) continue;
    const line = firstMatch(rule, log);
    if (line) {
      return result(rule.category, rule.weak ? 'medium' : 'high', rule.id, [
        `${rule.description}: ${redactSecrets(line).slice(0, 160)}`,
        ...retryNote,
      ]);
    }
  }

  if (signature.lines.length === 0) {
    return result('unknown', 'low', 'no-error-text', [
      'no error text was found in the log',
      ...retryNote,
    ]);
  }

  const stats = tests.map((id) => ({ id, stats: flipStats(history, id) }));
  const statEvidence = stats.map(({ id, stats: s }) =>
    describeStats(id, s, isFlaky(s, config.flaky), config.flaky),
  );
  const historyFlaky = stats.length > 0 && stats.every(({ stats: s }) => isFlaky(s, config.flaky));

  if (historyFlaky || (passedOnRetry && tests.length > 0)) {
    const ruleId =
      historyFlaky && passedOnRetry
        ? 'retry-and-history'
        : historyFlaky
          ? 'flip-history'
          : 'retry-passed';
    const confidence: Confidence = historyFlaky && passedOnRetry ? 'high' : 'medium';
    return result('flaky', confidence, ruleId, [...retryNote, ...statEvidence]);
  }

  if (passedOnRetry) {
    return result('flaky', 'low', 'retry-passed', [
      ...retryNote,
      'no failing test was identified, so the history could not be checked',
    ]);
  }

  const compile = firstMatch(
    { id: 'compile', category: 'dependency', pattern: COMPILE, description: '' },
    log,
  );
  if (compile) {
    return result('regression', 'high', 'compile-error', [
      `build or type error: ${compile.slice(0, 160)}`,
    ]);
  }
  if (tests.length > 0) {
    const stable = stats.every(
      ({ stats: s }) => s.observedCommits >= config.flaky.min_observations && s.flipCommits === 0,
    );
    return result('regression', stable ? 'high' : 'medium', 'test-failure', statEvidence);
  }
  return result('regression', 'low', 'unclassified-error', [
    `no rule matched; first error line: ${signature.lines[0] ?? ''}`,
  ]);
}
