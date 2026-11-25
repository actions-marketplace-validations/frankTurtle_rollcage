/**
 * Writes the recorded model responses the demo replays, in the shared record/replay format.
 *
 * The answers below are written by hand, so the fixtures are stand-ins and not real model output.
 * To record real ones, run with ANTHROPIC_API_KEY set and DEMO_LIVE=1:
 *   DEMO_LIVE=1 pnpm --filter @adl/policy-gates exec tsx demo/record-fixtures.ts
 */
import { AnthropicLlm, RecordReplayLlm, isLiveMode, type LlmClient } from '@adl/shared';
import { runCli } from '../src/cli.ts';
import { createConftestRunner } from '../src/conftest.ts';
import { LLM_FIXTURE_DIR } from '../src/paths.ts';
import { PLAN, prepare, WORKFLOW } from './work.ts';

const ANSWERS: Record<string, { explanation: string; assumptions: string[] }> = {
  PG001: {
    explanation:
      'The bucket ACL grants read access to everyone on the internet, so anyone can list and download its objects.',
    assumptions: ['The bucket is not meant to serve public content.'],
  },
  PG002: {
    explanation:
      'Data on this resource is stored unencrypted, so a copied disk or snapshot would be readable.',
    assumptions: ['No account-level default encryption already covers this resource.'],
  },
  PG003: {
    explanation:
      'The policy grants more access than a deploy role needs, so a leaked role could act on every resource in the account.',
    assumptions: ['The role is only used by one deploy job.'],
  },
  PG004: {
    explanation:
      'A tag can be moved to different code after you reviewed it, so the workflow could run changed code without any diff in this repository.',
    assumptions: ['The action is maintained by someone outside your team.'],
  },
  PG005: {
    explanation:
      'With no permissions block the job token gets the repository default, which may include write access it does not use.',
    assumptions: ['The repository default token permission is read and write.'],
  },
  PG006: {
    explanation:
      'Stored cloud keys are long lived and can leak from logs or forks. OIDC gives each run a short lived credential instead.',
    assumptions: ['The cloud account can trust the GitHub OIDC provider.'],
  },
};

/** Stand-in for the live client: answers from the table above by the rule ID in the prompt. */
const handWritten: LlmClient = {
  async complete(request) {
    const id = /^Rule: (PG\d{3})/m.exec(request.prompt)?.[1] ?? '';
    const answer = ANSWERS[id];
    if (!answer) throw new Error(`no hand-written answer for rule ${id}`);
    return { text: JSON.stringify(answer), model: 'hand-written-fixture' };
  },
};

const live = isLiveMode(process.env);
const source = live ? new AnthropicLlm(process.env) : handWritten;
const recorder = new RecordReplayLlm(LLM_FIXTURE_DIR, 'record', source);

prepare('violating');
process.exitCode = await runCli(['check', PLAN, WORKFLOW, '--explain'], {
  env: process.env,
  out: () => undefined,
  err: (text) => console.error(text),
  runner: createConftestRunner(),
  createLlm: () => recorder,
});
// Exit 1 is the gate failing on the violating fixtures, which is the point.
if (process.exitCode === 1) process.exitCode = 0;
console.log(`Recorded fixtures in ${LLM_FIXTURE_DIR}`);
