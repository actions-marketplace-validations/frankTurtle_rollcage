/**
 * Writes the replay fixtures the demo and one test use (demo/llm-fixtures).
 *
 * By default the "live" model is a scripted stand-in, so these fixtures are HAND-AUTHORED, not real
 * model output. With DEMO_LIVE=1 and ANTHROPIC_API_KEY set, it records real responses instead.
 * Re-run this whenever the prompt in src/summarize.ts changes; the replay test in
 * tests/cli.test.ts fails if the fixtures are stale.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicLlm, RecordReplayLlm, isLiveMode } from '@adl/shared';
import type { LlmClient, LlmRequest, LlmResponse } from '@adl/shared';
import { loadConfig } from '../src/config.ts';
import { loadHistory } from '../src/history.ts';
import { parseRuns } from '../src/runs.ts';
import { triageItem } from '../src/triage.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '..', 'fixtures');

const REPLIES: Record<string, { summary: string; next_step: string; assumptions: string[] }> = {
  'test-failure': {
    summary:
      'The test "caps percent at 100" expects a total of 0 but gets -20, so a discount above 100 percent is not being clamped. The same test has not failed and passed on one commit before.',
    next_step: 'Clamp the percent in applyDiscount to 100, then run tests/cart/discount.test.ts.',
    assumptions: [
      'Assumed this branch changed the discount code; the log alone does not show which commit did.',
    ],
  },
  'disk-full': {
    summary:
      'The Docker build ran out of disk space while installing packages, so the job stopped. This points at the runner, not at the change.',
    next_step:
      'Free disk space before the build (prune images, clear caches) or move the job to a larger runner, then re-run.',
    assumptions: ['Assumed the disk filled up from the image layers and package cache.'],
  },
  'lockfile-outdated': {
    summary:
      'pnpm refused to install because pnpm-lock.yaml does not match package.json: the lockfile has zod ^3.23.0 and the manifest has ^3.24.0.',
    next_step: 'Run pnpm install locally, commit the updated pnpm-lock.yaml, and push.',
    assumptions: [
      'Assumed the manifest edit was intended and the lockfile was simply not committed.',
    ],
  },
  'retry-and-history': {
    summary:
      'The test "creates an order" timed out. The same commit passed on a later run, and this test has failed and passed on the same commit before, so it looks flaky rather than broken.',
    next_step:
      'Review the quarantine proposal for this test and assign an owner to fix the timing. Re-run is safe if the change is urgent.',
    assumptions: [
      'Assumed the timeout comes from a slow dependency in the test, not from this change.',
      'The flaky call is a heuristic from run history; the cause is not confirmed.',
    ],
  },
  'rate-limit': {
    summary:
      'Docker Hub answered 429 Too Many Requests while the build pulled the node base image, so the build never started. This is a pull rate limit, not a code problem.',
    next_step:
      'Authenticate the Docker pull in the workflow or use a mirrored base image, then re-run.',
    assumptions: ['Assumed the pull was anonymous, as the log message says.'],
  },
  'compile-error': {
    summary:
      'The type check failed in src/export/csv.ts: a string or undefined value is passed where a string is required, and a number is assigned to a string.',
    next_step:
      'Handle the undefined case at the call site and fix the number-to-string assignment, then run pnpm typecheck.',
    assumptions: ['Assumed both errors come from the same recent edit to csv.ts.'],
  },
};

/** Scripted stand-in for the model: reads the rule id out of the prompt and returns the matching reply. */
const scripted: LlmClient = {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const { rule } = JSON.parse(request.prompt) as { rule: string };
    const reply = REPLIES[rule];
    if (!reply) throw new Error(`no scripted reply for rule ${rule}`);
    return { text: JSON.stringify(reply), model: 'scripted' };
  },
};

const runs = parseRuns(readFileSync(join(fixtures, 'runs.json'), 'utf8'));
const history = loadHistory(readFileSync(join(fixtures, 'history.json'), 'utf8'));
const config = loadConfig();
const backend: LlmClient = isLiveMode(process.env) ? new AnthropicLlm(process.env) : scripted;
const llm = new RecordReplayLlm(join(here, 'llm-fixtures'), 'record', backend);

for (const run of runs.filter((r) => r.logFile)) {
  const log = readFileSync(join(fixtures, run.logFile as string), 'utf8');
  const out = await triageItem(
    { id: `${run.id}#${run.attempt}`, log, run },
    { allRuns: runs, history, config, llm },
  );
  console.log(`${out.id}: recorded (${out.summarySource}, ${out.category})`);
}
