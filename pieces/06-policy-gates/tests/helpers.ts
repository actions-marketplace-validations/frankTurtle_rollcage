import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConftestRunner } from '../src/conftest.js';

export const PIECE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const POLICY_DIR = join(PIECE_DIR, 'policies');
export const MAPPING_PATH = join(POLICY_DIR, 'controls.json');
export const EXAMPLES = join(PIECE_DIR, 'examples');

const meta = (ns: string) => ({ query: `data.${ns}.deny` });

/** Conftest JSON as it prints it: one entry per file and namespace, failures only when present. */
export const SAMPLE_CONFTEST_JSON = JSON.stringify([
  { filename: 'infra/plan.json', namespace: 'workflows', successes: 5 },
  {
    filename: 'infra/plan.json',
    namespace: 'terraform',
    successes: 2,
    failures: [
      {
        msg: 'PG003: aws_iam_role_policy.deploy allows the wildcard resource "*"',
        metadata: meta('terraform'),
      },
      {
        msg: 'PG001: aws_s3_bucket.assets has the public ACL "public-read"',
        metadata: meta('terraform'),
      },
    ],
  },
  {
    filename: '.github/workflows/deploy.yml',
    namespace: 'workflows',
    successes: 3,
    failures: [
      {
        msg: 'PG004: jobs.deploy.steps[0] uses "actions/checkout@v4", which is not pinned to a full commit SHA',
        metadata: meta('workflows'),
      },
    ],
    warnings: [{ msg: 'PG999: a warning is not a failure' }],
  },
]);

export const CLEAN_CONFTEST_JSON = JSON.stringify([
  { filename: 'infra/plan.json', namespace: 'terraform', successes: 7 },
]);

export interface FakeRunner extends ConftestRunner {
  calls: Parameters<ConftestRunner['run']>[0][];
}

export function fakeRunner(output: string | Error): FakeRunner {
  const calls: FakeRunner['calls'] = [];
  return {
    calls,
    async run(options) {
      calls.push(options);
      if (output instanceof Error) throw output;
      return output;
    },
  };
}

export function collector(): { out: string[]; err: string[]; text: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, text: () => out.join('\n') };
}
