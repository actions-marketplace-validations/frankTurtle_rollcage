import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { AnthropicLlm, isLiveMode } from '@adl/shared';
import { ceCostPort, fixtureCostPort } from './adapters.ts';
import { FIXTURE_NOW } from './fixture-data.ts';
import { loadConfig } from './lambda/config.ts';
import { runReport } from './report.ts';

/**
 * `cost-explainer report [--live]` prints the weekly message. It never sends it.
 * --live makes read-only Cost Explorer calls with your default AWS credentials. The model is called
 * only when DEMO_LIVE=1 and ANTHROPIC_API_KEY is set. TAG_KEY, MIN_DELTA_USD, MIN_DELTA_PCT and
 * EXPECTED_CHANGES apply here as they do in the Lambda.
 */
const args = process.argv.slice(2).filter((a) => a !== '--');
if (args[0] !== 'report') {
  console.error('usage: cost-explainer report [--live]');
  process.exit(2);
}
const live = args.includes('--live');
const config = loadConfig(process.env);

const report = await runReport({
  now: live ? new Date() : FIXTURE_NOW,
  config: config.analysis,
  tagKey: config.tagKey,
  cost: live ? ceCostPort(new CostExplorerClient({ region: 'us-east-1' })) : fixtureCostPort(),
  ...(isLiveMode() ? { llm: new AnthropicLlm() } : {}),
  channels: [],
});
console.log(report.message.subject);
console.log(`\n${report.message.text}`);
