import { completeStructured } from '@adl/shared';
import type { LlmClient } from '@adl/shared';
import { z } from 'zod';
import type { Category, Classification } from './classify.js';
import type { TriageConfig } from './config.js';
import { redactSecrets as redact } from '@adl/shared';

export interface SummaryInput {
  classification: Classification;
  /** Normalized error signature text. */
  signature: string;
  tests: string[];
  /** Error lines from the log. Redacted again here before they go into a prompt. */
  excerpt: string[];
  config: TriageConfig;
}

export interface Summary {
  summary: string;
  nextStep: string;
  /** What the summary assumes. Never empty. */
  assumptions: string[];
  source: 'model' | 'fallback';
  /** Why the fallback was used. Present only when source is 'fallback'. */
  reason?: string;
}

const ReplySchema = z.object({
  summary: z.string().min(1).max(800),
  next_step: z.string().min(1).max(600),
  assumptions: z.array(z.string().min(1)).min(1),
});

const SYSTEM = [
  'You explain failed CI runs to an engineer.',
  'The category and confidence were decided by rules in code. Do not change the category.',
  'Never state a root cause as confirmed. Say what the evidence suggests and list what you assumed.',
  'Reply with JSON only: {"summary": string, "next_step": string, "assumptions": string[]}.',
  'The summary is at most three sentences. The next step is one concrete action. List at least one assumption.',
].join(' ');

const FALLBACK: Record<Category, { summary: string; nextStep: string }> = {
  regression: {
    summary:
      'The failure looks like a code problem: the log shows a test, build or type error that is not explained by the pipeline.',
    nextStep:
      'Read the failing lines in the log, reproduce locally on this commit, and fix or revert the change that introduced it.',
  },
  flaky: {
    summary:
      'The failure looks flaky: the same commit passed on a later run, or the failing test has a history of failing and passing on the same commit.',
    nextStep:
      'Re-run once if the change is urgent, then review the quarantine proposal and assign an owner to fix the test.',
  },
  infrastructure: {
    summary:
      'The failure looks like a runner or environment problem, such as disk, memory, network or a rate limit, not a code change.',
    nextStep:
      'Re-run the job. If it fails the same way again, fix the runner or service limit named in the log, for example by freeing disk or authenticating the pull.',
  },
  dependency: {
    summary:
      'The failure looks like a dependency problem: the registry, version resolution or lockfile did not match what the build needed.',
    nextStep:
      'Check the manifest and lockfile for a mismatch, regenerate the lockfile locally, and commit it, or retry later if the registry was down.',
  },
  unknown: {
    summary: 'No error text was found in the log, so no category could be decided.',
    nextStep:
      'Open the raw log for this run and check that the failing step wrote output. Fetch the full log if it was truncated.',
  },
};

const HEURISTIC =
  'The category is a heuristic reading of the log and run history, not a confirmed root cause.';

export function fallbackSummary(input: SummaryInput): Omit<Summary, 'source' | 'reason'> {
  const base = FALLBACK[input.classification.category];
  const named = input.tests.length ? ` Failing: ${input.tests.slice(0, 3).join('; ')}.` : '';
  return { summary: `${base.summary}${named}`, nextStep: base.nextStep, assumptions: [HEURISTIC] };
}

function buildPrompt(input: SummaryInput): string {
  const { classification: c } = input;
  return JSON.stringify(
    {
      category: c.category,
      confidence: c.confidence,
      rule: c.ruleId,
      evidence: c.evidence.map(redact),
      signature: redact(input.signature),
      failing_tests: input.tests,
      log_excerpt: input.excerpt.slice(0, input.config.log.excerpt_lines).map(redact),
    },
    null,
    2,
  );
}

/**
 * Ask the model for a summary and next step. The category is an input and is never read back from
 * the reply. Invalid output retries once, then the fixed text for the category is used.
 */
export async function summarize(llm: LlmClient, input: SummaryInput): Promise<Summary> {
  const fallback = fallbackSummary(input);
  const result = await completeStructured(
    llm,
    { system: SYSTEM, prompt: buildPrompt(input), maxTokens: 600 },
    ReplySchema,
    () => ({
      summary: fallback.summary,
      next_step: fallback.nextStep,
      assumptions: fallback.assumptions,
    }),
  );
  return {
    summary: result.value.summary,
    nextStep: result.value.next_step,
    assumptions: result.value.assumptions,
    source: result.source,
    ...(result.reason ? { reason: result.reason } : {}),
  };
}
