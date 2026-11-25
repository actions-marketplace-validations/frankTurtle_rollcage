import type { CostExplorerClient } from '@aws-sdk/client-cost-explorer';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SNSClient } from '@aws-sdk/client-sns';
import { describe, expect, it } from 'vitest';
import {
  ceCostPort,
  fixtureCostPort,
  secretReader,
  slackNotifier,
  snsNotifier,
} from '../src/adapters.ts';
import { FIXTURE } from '../src/fixture-data.ts';
import { UNTAGGED } from '../src/types.ts';
import { must } from './helpers.ts';

interface Sent {
  name: string;
  input: Record<string, unknown>;
}

/** A fake SDK client: records each command and answers from a script, in order. */
function fakeClient<T>(replies: unknown[]): { client: T; sent: Sent[] } {
  const sent: Sent[] = [];
  const queue = [...replies];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: command.constructor.name, input: command.input });
      return queue.shift();
    },
  } as unknown as T;
  return { client, sent };
}

const day = (key: string, amount: string) => ({
  Keys: [key],
  Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } },
});
const range = { start: '2026-11-16', end: '2026-11-23' };

describe('AC-11 the Cost Explorer adapter', () => {
  it('sums daily results by service and follows pagination', async () => {
    const { client, sent } = fakeClient<CostExplorerClient>([
      {
        ResultsByTime: [{ Groups: [day('AWS Lambda', '10.50'), day('AmazonCloudWatch', '1')] }],
        NextPageToken: 'p2',
      },
      { ResultsByTime: [{ Groups: [day('AWS Lambda', '4.50')] }] },
    ]);
    const rows = await ceCostPort(client).costByGroup(range, { type: 'SERVICE' });
    expect(rows).toEqual([
      { key: 'AWS Lambda', amount: 15 },
      { key: 'AmazonCloudWatch', amount: 1 },
    ]);
    expect(sent.map((s) => s.name)).toEqual(['GetCostAndUsageCommand', 'GetCostAndUsageCommand']);
    expect(must(sent[0]).input).toMatchObject({
      TimePeriod: { Start: '2026-11-16', End: '2026-11-23' },
      Granularity: 'DAILY',
      Metrics: ['UnblendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
    });
    expect(must(sent[1]).input['NextPageToken']).toBe('p2');
  });

  it('groups by tag, strips the key prefix and names untagged spend', async () => {
    const { client, sent } = fakeClient<CostExplorerClient>([
      { ResultsByTime: [{ Groups: [day('team$data', '5'), day('team$', '2')] }] },
    ]);
    const rows = await ceCostPort(client).costByGroup(range, { type: 'TAG', key: 'team' });
    expect(rows).toEqual([
      { key: 'data', amount: 5 },
      { key: UNTAGGED, amount: 2 },
    ]);
    expect(must(sent[0]).input['GroupBy']).toEqual([{ Type: 'TAG', Key: 'team' }]);
  });

  it('rejects an amount that is not a number', async () => {
    const { client } = fakeClient<CostExplorerClient>([
      { ResultsByTime: [{ Groups: [day('AWS Lambda', 'abc')] }] },
    ]);
    await expect(ceCostPort(client).costByGroup(range, { type: 'SERVICE' })).rejects.toThrow(
      /not a number/,
    );
  });

  it('reads anomalies, with pagination, and issues only GetAnomalies', async () => {
    const anomaly = (id: string, service: string) => ({
      AnomalyId: id,
      AnomalyStartDate: '2026-11-17',
      Impact: { MaxImpact: 10, TotalImpact: 252.4 },
      RootCauses: [{ Service: service, Region: 'us-east-1', UsageType: 'NatGateway-Bytes' }],
    });
    const { client, sent } = fakeClient<CostExplorerClient>([
      { Anomalies: [anomaly('a1', 'EC2 - Other')], NextPageToken: 'n' },
      { Anomalies: [{ AnomalyId: 'a2', DimensionValue: 'AWS Lambda', Impact: { MaxImpact: 1 } }] },
    ]);
    const found = await ceCostPort(client).anomalies(range);
    expect(found[0]).toEqual({
      id: 'a1',
      service: 'EC2 - Other',
      startDate: '2026-11-17',
      totalImpact: 252.4,
      rootCauses: ['NatGateway-Bytes in us-east-1'],
    });
    expect(found[1]).toMatchObject({ id: 'a2', service: 'AWS Lambda', totalImpact: 0 });
    expect(sent.map((s) => s.name)).toEqual(['GetAnomaliesCommand', 'GetAnomaliesCommand']);
    expect(must(sent[0]).input['DateInterval']).toEqual({
      StartDate: '2026-11-16',
      EndDate: '2026-11-23',
    });
  });

  it('skips anomalies with no id or no service', async () => {
    const { client } = fakeClient<CostExplorerClient>([
      { Anomalies: [{ Impact: { MaxImpact: 1 } }, { AnomalyId: 'x', Impact: { MaxImpact: 1 } }] },
    ]);
    expect(await ceCostPort(client).anomalies(range)).toEqual([]);
  });
});

describe('fixture cost port', () => {
  it('answers by week and grouping, and never needs a client', async () => {
    const port = fixtureCostPort(FIXTURE);
    const cur = await port.costByGroup(FIXTURE.ranges.current, { type: 'SERVICE' });
    const prev = await port.costByGroup(FIXTURE.ranges.previous, { type: 'TAG', key: 'team' });
    expect(cur.find((r) => r.key === 'AWS Lambda')?.amount).toBe(95);
    expect(prev.find((r) => r.key === 'data')?.amount).toBe(560);
    expect(await port.anomalies(FIXTURE.ranges.current)).toHaveLength(2);
  });
});

describe('AC-9/10 notifiers', () => {
  it('publishes to SNS with a subject within the limit', async () => {
    const { client, sent } = fakeClient<SNSClient>([{}]);
    await snsNotifier(client, 'arn:aws:sns:us-east-1:111122223333:t').send('s'.repeat(150), 'body');
    expect(must(sent[0]).name).toBe('PublishCommand');
    expect((must(sent[0]).input['Subject'] as string).length).toBe(100);
    expect(must(sent[0]).input['TopicArn']).toBe('arn:aws:sns:us-east-1:111122223333:t');
  });

  it('posts to a Slack webhook read from the secret, and only an https hooks.slack.com URL', async () => {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: init.body });
      return { ok: true, status: 200 };
    }) as unknown as typeof fetch;
    const url = 'https://hooks.slack.com/services/T000/B000/FAKEFAKEFAKE';
    await slackNotifier(async () => url, fetchImpl).send('subj', 'text');
    expect(must(calls[0]).url).toBe(url);
    expect(JSON.parse(must(calls[0]).body)).toEqual({ text: '*subj*\ntext' });

    for (const bad of ['http://hooks.slack.com/services/x', 'https://evil.example/hooks', '']) {
      await expect(slackNotifier(async () => bad, fetchImpl).send('s', 't')).rejects.toThrow(
        /not a Slack webhook URL/,
      );
    }
    expect(calls).toHaveLength(1);
  });

  it('does not put the webhook URL in an error', async () => {
    const url = 'https://hooks.slack.com/services/T000/B000/FAKEFAKEFAKE';
    const fetchImpl = (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    const error = await slackNotifier(async () => url, fetchImpl)
      .send('s', 't')
      .catch((e: Error) => e);
    expect((error as Error).message).toBe('Slack webhook returned status 500');
  });
});

describe('secret reader', () => {
  it('returns the secret string and rejects an empty secret', async () => {
    const ok = fakeClient<SecretsManagerClient>([{ SecretString: 'value' }]);
    expect(await secretReader(ok.client)('arn')).toBe('value');
    expect(must(ok.sent[0]).input).toEqual({ SecretId: 'arn' });
    const empty = fakeClient<SecretsManagerClient>([{}]);
    await expect(secretReader(empty.client)('arn')).rejects.toThrow(/no string value/);
  });
});
