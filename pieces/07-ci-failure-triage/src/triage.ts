import type { LlmClient } from '@adl/shared';
import { classify } from './classify.js';
import type { Classification } from './classify.js';
import type { TriageConfig } from './config.js';
import type { History } from './history.js';
import { passedLater } from './runs.js';
import type { RunRecord } from './runs.js';
import { excerpt, extractSignature, extractTests } from './signature.js';
import { summarize } from './summarize.js';
import type { Summary } from './summarize.js';

/** One failed run (or one local log file) and its log text. */
export interface TriageItem {
  /** `runId#attempt` for a run, the file path for a local log. */
  id: string;
  log: string;
  run?: RunRecord | undefined;
}

export interface TriagedRun extends Classification {
  id: string;
  workflow?: string;
  branch?: string;
  sha?: string;
  signature: { hash: string; text: string };
  tests: string[];
  passedOnRetry: boolean;
  summary: string;
  nextStep: string;
  assumptions: string[];
  summarySource: Summary['source'];
  summaryReason?: string;
}

export interface TriageContext {
  /** Every run record, so a later pass of the same commit can be found. */
  allRuns: readonly RunRecord[];
  history: History;
  config: TriageConfig;
  llm: LlmClient;
}

export async function triageItem(item: TriageItem, ctx: TriageContext): Promise<TriagedRun> {
  const { run } = item;
  const signature = extractSignature(item.log, { maxErrorLines: ctx.config.log.max_error_lines });
  const tests = extractTests(item.log);
  const passedOnRetry = run ? passedLater(run, ctx.allRuns) : false;
  const classification = classify({
    log: item.log,
    signature,
    tests,
    passedOnRetry,
    history: ctx.history,
    config: ctx.config,
  });
  const summary = await summarize(ctx.llm, {
    classification,
    signature: signature.text,
    tests,
    excerpt: excerpt(item.log, ctx.config.log.excerpt_lines),
    config: ctx.config,
  });
  return {
    id: item.id,
    ...(run ? { workflow: run.workflow, branch: run.branch, sha: run.sha } : {}),
    ...classification,
    signature: { hash: signature.hash, text: signature.text },
    tests,
    passedOnRetry,
    summary: summary.summary,
    nextStep: summary.nextStep,
    assumptions: summary.assumptions,
    summarySource: summary.source,
    ...(summary.reason ? { summaryReason: summary.reason } : {}),
  };
}
