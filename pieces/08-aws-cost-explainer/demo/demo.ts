/**
 * Demo driver. Runs the real report code on fixture cost data. The model's reply is a recorded
 * fixture (demo/recorded-reply.json), and the notification channels are fakes that print what they
 * would send. Nothing touches AWS, Slack or the network unless DEMO_LIVE=1 adds a model call.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnthropicLlm, FakeLlm, green, header, isLiveMode, red, runStages } from '@adl/shared';
import type { LlmClient } from '@adl/shared';
import { analyze } from '../src/analysis.ts';
import { fixtureCostPort } from '../src/adapters.ts';
import { FIXTURE, FIXTURE_CONFIG, FIXTURE_NOW, fixtureAnalysisInput } from '../src/fixture-data.ts';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';
import { runReport } from '../src/report.ts';
import type { Report } from '../src/report.ts';
import type { NotifyPort } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
const recorded = readFileSync(join(here, 'recorded-reply.json'), 'utf8');

const base = { now: FIXTURE_NOW, config: FIXTURE_CONFIG, cost: fixtureCostPort() };

/** A channel that sends nothing. `failWith` simulates an outage. */
const channel = (name: string, failWith?: string): NotifyPort => ({
  name,
  async send() {
    if (failWith) throw new Error(failWith);
  },
});

const showDeliveries = (r: Report): void => {
  for (const d of r.deliveries) {
    console.log(`  ${d.channel}: ${d.ok ? green('would send') : red(`failed (${d.error})`)}`);
  }
};

const model = (): LlmClient => (isLiveMode() ? new AnthropicLlm() : new FakeLlm([recorded]));

function before(): void {
  header('BEFORE: what Cost Explorer returns');
  console.log('One row per service, per day, per week. A few of them:\n');
  for (const r of FIXTURE.services.current.slice(0, 4)) {
    console.log(
      `  {"Keys":["${r.key}"],"Metrics":{"UnblendedCost":{"Amount":"${r.amount.toFixed(2)}"}}}`,
    );
  }
  console.log('\n  ... 8 services, 14 days, plus anomalies and tag groups.');
  console.log(red('\nNobody reads this on Monday. The invoice arrives at month end.'));
}

async function run(): Promise<void> {
  header('RUN: the Monday job (fixture data)');
  const r = await runReport({
    ...base,
    llm: model(),
    channels: [channel('sns (email)'), channel('slack webhook')],
  });
  console.log(`\n${r.message.subject}\n`);
  console.log(r.message.text);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'message.txt'), `${r.message.subject}\n\n${r.message.text}\n`);
  console.log(
    `\nsummary source: ${r.summary.source}${isLiveMode() ? ' (live model)' : ' (recorded reply)'}`,
  );
  console.log('\nDeliveries:');
  showDeliveries(r);
  console.log(`saved to demo/out/message.txt`);
}

async function after(): Promise<void> {
  header('AFTER: the guard rails');
  console.log('1. The model quotes a dollar figure that is not in the data.\n');
  const invented = JSON.stringify({
    headline: 'Spend rose $9,999 this week.',
    paragraphs: ['A large increase hit the account.'],
    assumptions: ['Assumption: none.'],
  });
  const r = await runReport({
    ...base,
    llm: new FakeLlm([invented, invented]),
    channels: [channel('sns (email)')],
  });
  console.log(`  summary source: ${red(r.summary.source)}`);
  console.log(`  reason: ${r.summary.reason}`);
  console.log(`  headline sent instead: ${r.summary.summary.headline}`);

  console.log('\n2. Slack is down. The email still goes out.\n');
  const s = await runReport({
    ...base,
    channels: [
      channel('slack webhook', 'Slack webhook returned status 500'),
      channel('sns (email)'),
    ],
  });
  showDeliveries(s);
}

function metric(): void {
  header('METRIC');
  for (const line of formatMetrics(
    computeMetrics(analyze(fixtureAnalysisInput())),
    'fixture data, not a real bill',
  )) {
    console.log(line);
  }
}

process.exitCode = await runStages({ before, run, after, metric }, process.argv[2]);
