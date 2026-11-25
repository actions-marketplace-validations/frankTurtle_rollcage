import type { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import { GetAnomaliesCommand, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { SNSClient } from '@aws-sdk/client-sns';
import { PublishCommand } from '@aws-sdk/client-sns';
import { FIXTURE } from './fixture-data.ts';
import type { FixtureSnapshot } from './fixture-data.ts';
import { UNTAGGED } from './types.ts';
import type { Anomaly, CostPort, CostRow, DateRange, Grouping, NotifyPort } from './types.ts';

/** Thin wrappers over the AWS SDK v3 and fetch. They hold no decisions; the logic is in analysis.ts. */

/** Read-only: this adapter can only issue GetCostAndUsage and GetAnomalies. */
export function ceCostPort(client: CostExplorerClient): CostPort {
  return {
    async costByGroup(range, grouping) {
      const totals = new Map<string, number>();
      let token: string | undefined;
      do {
        const out = await client.send(
          new GetCostAndUsageCommand({
            TimePeriod: { Start: range.start, End: range.end },
            Granularity: 'DAILY',
            Metrics: ['UnblendedCost'],
            GroupBy: [
              grouping.type === 'SERVICE'
                ? { Type: 'DIMENSION', Key: 'SERVICE' }
                : { Type: 'TAG', Key: grouping.key },
            ],
            ...(token ? { NextPageToken: token } : {}),
          }),
        );
        for (const day of out.ResultsByTime ?? []) {
          for (const group of day.Groups ?? []) {
            const key = groupKey(group.Keys?.[0] ?? '', grouping);
            const amount = Number(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
            if (!Number.isFinite(amount)) throw new Error(`cost amount for ${key} is not a number`);
            totals.set(key, (totals.get(key) ?? 0) + amount);
          }
        }
        token = out.NextPageToken;
      } while (token);
      return [...totals].map(([key, amount]): CostRow => ({ key, amount }));
    },

    async anomalies(range) {
      const found: Anomaly[] = [];
      let token: string | undefined;
      do {
        const out = await client.send(
          new GetAnomaliesCommand({
            DateInterval: { StartDate: range.start, EndDate: range.end },
            ...(token ? { NextPageToken: token } : {}),
          }),
        );
        for (const a of out.Anomalies ?? []) {
          const service = a.RootCauses?.[0]?.Service ?? a.DimensionValue;
          if (!a.AnomalyId || !service) continue;
          found.push({
            id: a.AnomalyId,
            service,
            startDate: a.AnomalyStartDate ?? range.start,
            totalImpact: a.Impact?.TotalImpact ?? 0,
            rootCauses: (a.RootCauses ?? [])
              .map((c) => [c.UsageType, c.Region ? `in ${c.Region}` : ''].filter(Boolean).join(' '))
              .filter(Boolean),
          });
        }
        token = out.NextPageToken;
      } while (token);
      return found;
    },
  };
}

/** Cost Explorer names a tag group `key$value`, and `key$` for spend with no value. */
function groupKey(raw: string, grouping: Grouping): string {
  if (grouping.type === 'SERVICE') return raw;
  const value = raw.startsWith(`${grouping.key}$`) ? raw.slice(grouping.key.length + 1) : raw;
  return value === '' ? UNTAGGED : value;
}

/** Fixture data behind the same port, for tests, the demo and the Lambda's default mode. */
export function fixtureCostPort(snapshot: FixtureSnapshot = FIXTURE): CostPort {
  return {
    async costByGroup(range: DateRange, grouping: Grouping) {
      const week = range.start === snapshot.ranges.current.start ? 'current' : 'previous';
      return (grouping.type === 'SERVICE' ? snapshot.services : snapshot.tags)[week];
    },
    async anomalies() {
      return snapshot.anomalies;
    },
  };
}

export const snsNotifier = (client: SNSClient, topicArn: string): NotifyPort => ({
  name: 'sns',
  async send(subject, text) {
    await client.send(
      new PublishCommand({ TopicArn: topicArn, Subject: subject.slice(0, 100), Message: text }),
    );
  },
});

const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\//;

/** The URL is fetched from Secrets Manager on use and never appears in an error message. */
export const slackNotifier = (
  webhookUrl: () => Promise<string>,
  fetchImpl: typeof fetch = fetch,
): NotifyPort => ({
  name: 'slack',
  async send(subject, text) {
    const url = (await webhookUrl()).trim();
    if (!SLACK_WEBHOOK.test(url)) throw new Error('secret value is not a Slack webhook URL');
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `*${subject}*\n${text}` }),
    });
    if (!res.ok) throw new Error(`Slack webhook returned status ${res.status}`);
  },
});

export const secretReader =
  (client: SecretsManagerClient) =>
  async (secretId: string): Promise<string> => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!out.SecretString) throw new Error('secret has no string value');
    return out.SecretString;
  };
