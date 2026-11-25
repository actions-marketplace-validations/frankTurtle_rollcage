import { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { AnthropicLlm } from '@adl/shared';
import { ceCostPort, secretReader, slackNotifier, snsNotifier } from '../adapters.ts';
import type { NotifyPort } from '../types.ts';
import { loadConfig } from './config.ts';
import { createHandler } from './handler.ts';

/** Lambda entry point: wires the real AWS clients. Not unit tested; it holds no decisions. */
const env = process.env;

// The schedule is weekly, so every run is a cold start: read each secret once, when it is needed.
const readSecret = secretReader(new SecretsManagerClient({}));
const slackUrl = () => readSecret(env['SLACK_WEBHOOK_SECRET_ARN'] ?? '');

const handle = createHandler({
  config: loadConfig(env),
  // Cost Explorer's endpoint is in us-east-1.
  liveCost: () => ceCostPort(new CostExplorerClient({ region: 'us-east-1' })),
  now: () => new Date(),
  llm: async () => {
    if (!env['ANTHROPIC_KEY_SECRET_ARN']) return undefined;
    try {
      return new AnthropicLlm({
        ANTHROPIC_API_KEY: await readSecret(env['ANTHROPIC_KEY_SECRET_ARN']),
        ...(env['ANTHROPIC_MODEL'] ? { ANTHROPIC_MODEL: env['ANTHROPIC_MODEL'] } : {}),
      });
    } catch (error) {
      console.error('model key unavailable; using the deterministic summary', errorName(error));
      return undefined;
    }
  },
  channels: async () => {
    const channels: NotifyPort[] = [];
    if (env['TOPIC_ARN']) channels.push(snsNotifier(new SNSClient({}), env['TOPIC_ARN']));
    if (env['SLACK_WEBHOOK_SECRET_ARN']) channels.push(slackNotifier(slackUrl));
    return channels;
  },
});

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'Error');

export const handler = async () => {
  const result = await handle();
  console.log(JSON.stringify(result));
  return result;
};
