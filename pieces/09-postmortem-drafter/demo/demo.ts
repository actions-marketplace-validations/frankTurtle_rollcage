/**
 * Demo driver. The incident is FICTIONAL and generated in code, with planted fake secrets.
 * The model is a scripted stand-in unless DEMO_LIVE=1 and ANTHROPIC_API_KEY are set.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeLlm, header, isLiveMode, runStages } from '@adl/shared';
import type { LlmClient, LlmRequest } from '@adl/shared';
import { loadBundle } from '../src/bundle.ts';
import { runCli } from '../src/cli.ts';
import { Redactor } from '../src/redact.ts';
import { sampleBundleFiles } from '../src/sample-bundle.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), 'out');
const bundle = join(out, 'bundle');
const live = isLiveMode(process.env);

/** Made-up numbers for the metric stage. Not measurements. */
const INCIDENTS = [
  {
    id: 'INC-201',
    closed_at: '2026-01-12T10:00:00Z',
    postmortem_published_at: '2026-01-14T10:00:00Z',
  },
  {
    id: 'INC-202',
    closed_at: '2026-01-30T16:00:00Z',
    postmortem_published_at: '2026-02-03T16:00:00Z',
  },
  { id: 'INC-203', closed_at: '2026-02-18T09:00:00Z', postmortem_published_at: null },
  {
    id: 'INC-204',
    closed_at: '2026-03-04T15:47:00Z',
    postmortem_published_at: '2026-03-04T17:47:00Z',
  },
  { id: 'INC-205', closed_at: null, postmortem_published_at: null },
];

function writeBundle(): void {
  mkdirSync(bundle, { recursive: true });
  for (const [name, content] of Object.entries(sampleBundleFiles())) {
    writeFileSync(join(bundle, name), content);
  }
}

/** Stands in for the model: picks real event ids out of the prompt and writes plausible JSON. */
function scriptedModel(request: LlmRequest): string {
  const find = (pattern: RegExp): string => {
    const line = request.prompt.split('\n').find((l) => pattern.test(l));
    return (/^(E\d+) \|/.exec(line ?? '') ?? [])[1] ?? 'E01';
  };
  const deploy = find(/Deploy checkout v2\.14\.0/);
  const pool = find(/db pool wait/);
  const page = find(/Paged/);
  const rollback = find(/Deploy checkout v2\.13\.9/);
  const recovered = find(/back to baseline/);
  return JSON.stringify({
    summary:
      'Checkout returned errors and slow responses for about 100 minutes. It started shortly after a checkout deploy and ended after that deploy was rolled back.',
    impact:
      'Checkout requests failed or timed out while the error rate was elevated. The chat reports 31 percent errors at the peak. The number of affected customers is not in the data.',
    timeline: [
      { event_ids: [deploy], description: 'Checkout v2.14.0 was deployed.' },
      { event_ids: [page], description: 'On-call was paged for a high checkout error rate.' },
      { event_ids: [rollback], description: 'Checkout was rolled back to v2.13.9.' },
      { event_ids: [recovered], description: 'The error rate returned to baseline.' },
    ],
    contributing_factors: [
      {
        description:
          'The v2.14.0 change may have increased database connection use, which would fit the pool wait warning before the page.',
        status: 'hypothesis',
        evidence_event_ids: [deploy, pool],
      },
      {
        description:
          'Alerting may have fired later than the first warning signs, since the pool warning came before the page.',
        status: 'hypothesis',
        evidence_event_ids: [pool, page],
      },
    ],
    action_items: [
      { description: 'Add a connection pool wait alert for checkout.' },
      { description: 'Check the v2.14.0 change for connection handling.' },
      { description: 'Remove secrets and card numbers from logs and chat.' },
    ],
  });
}

const model: LlmClient | undefined = live ? undefined : new FakeLlm([scriptedModel]);

const cli = (args: string[]): Promise<number> =>
  runCli(args, {
    env: process.env,
    out: (t) => console.log(t),
    err: (t) => console.error(t),
    ...(model ? { llm: model } : {}),
  });

function before(): void {
  header('BEFORE: the raw incident bundle (fictional data)');
  writeBundle();
  const redactor = new Redactor();
  const { events } = loadBundle(bundle);
  for (const event of events) redactor.redact(event.text);
  const report = redactor.report();
  console.log(`Files: ${Object.keys(sampleBundleFiles()).join(', ')}`);
  console.log(`Events in the bundle: ${events.length}`);
  console.log(`Sensitive values a model would see without redaction: ${report.total}`);
  for (const [type, c] of Object.entries(report.byType)) {
    console.log(`  ${type.padEnd(22)} ${c.occurrences}`);
  }
}

async function run(): Promise<void> {
  header(live ? 'RUN: draft with the live model' : 'RUN: draft (scripted stand-in for the model)');
  if (!existsSync(bundle)) writeBundle();
  const code = await cli(['draft', '--bundle', bundle, '--out', out]);
  if (code !== 0) process.exitCode = code;
}

async function after(): Promise<void> {
  if (!existsSync(join(out, 'postmortem.md'))) await run();
  header('AFTER: the draft postmortem');
  console.log(readFileSync(join(out, 'postmortem.md'), 'utf8'));
  header('AFTER: redaction-report.json (counts and types only)');
  console.log(readFileSync(join(out, 'redaction-report.json'), 'utf8'));
}

async function metric(): Promise<void> {
  header('METRIC: close to publish, and share with a postmortem (FIXTURE numbers)');
  mkdirSync(out, { recursive: true });
  const file = join(out, 'incidents.json');
  writeFileSync(file, `${JSON.stringify(INCIDENTS, null, 2)}\n`);
  await cli(['metrics', '--incidents', file]);
}

const stage = process.argv[2] ?? 'all';
if (stage === 'all' || stage === 'before') rmSync(out, { recursive: true, force: true });
process.exitCode = await runStages({ before, run, after, metric }, stage);
