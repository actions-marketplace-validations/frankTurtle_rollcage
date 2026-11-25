import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/lambda/config.ts';
import { createHandler } from '../src/lambda/handler.ts';
import type { CostPort } from '../src/types.ts';
import { fakeChannel, GOOD_REPLY } from './helpers.ts';

describe('AC-12 fixture mode is the default', () => {
  it('uses defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      dataSource: 'fixture',
      analysis: { minDeltaUsd: 25, minDeltaPct: 20, expectedChanges: [] },
      tagKey: 'team',
    });
  });

  it('goes live only for exactly "live"', () => {
    expect(loadConfig({ DATA_SOURCE: 'live' }).dataSource).toBe('live');
    for (const v of ['LIVE', 'true', '1', ' live', '']) {
      expect(loadConfig({ DATA_SOURCE: v }).dataSource).toBe('fixture');
    }
  });

  it('reads thresholds, tag key and the expected list', () => {
    const c = loadConfig({
      MIN_DELTA_USD: '50',
      MIN_DELTA_PCT: '10',
      TAG_KEY: 'owner',
      EXPECTED_CHANGES: 'AWS Lambda, Amazon S3 ,',
    });
    expect(c.analysis).toEqual({
      minDeltaUsd: 50,
      minDeltaPct: 10,
      expectedChanges: ['AWS Lambda', 'Amazon S3'],
    });
    expect(c.tagKey).toBe('owner');
  });

  it('rejects a non-numeric threshold', () => {
    expect(() => loadConfig({ MIN_DELTA_USD: 'abc' })).toThrow();
  });
});

describe('the handler', () => {
  const never = (): CostPort => {
    throw new Error('live Cost Explorer must not be touched in fixture mode');
  };

  it('runs on the fixture without touching live data, and returns a short result', async () => {
    const channel = fakeChannel('sns');
    const handler = createHandler({
      config: loadConfig({ EXPECTED_CHANGES: 'AWS Lambda' }),
      liveCost: never,
      now: () => new Date('2030-01-01T00:00:00Z'),
      llm: async () => new FakeLlm([GOOD_REPLY]),
      channels: async () => [channel],
    });
    const result = await handler();
    expect(result).toMatchObject({
      dataSource: 'fixture',
      summarySource: 'model',
      unexplainedUsd: 580,
      anomalies: 2,
      deliveries: [{ channel: 'sns', ok: true }],
    });
    expect(channel.sent).toHaveLength(1);
  });

  it('skips the model when none is configured', async () => {
    const handler = createHandler({
      config: loadConfig({}),
      liveCost: never,
      now: () => new Date(),
      llm: async () => undefined,
      channels: async () => [],
    });
    const result = await handler();
    expect(result.summarySource).toBe('fallback');
    expect(result.reason).toBe('no model configured');
  });

  it('uses the live port and the real clock in live mode', async () => {
    const asked: string[] = [];
    const live: CostPort = {
      async costByGroup(range, grouping) {
        asked.push(`${range.start}:${grouping.type}`);
        return [];
      },
      async anomalies() {
        return [];
      },
    };
    const handler = createHandler({
      config: loadConfig({ DATA_SOURCE: 'live' }),
      liveCost: () => live,
      now: () => new Date('2026-12-07T08:00:00Z'),
      llm: async () => undefined,
      channels: async () => [],
    });
    const result = await handler();
    expect(result.dataSource).toBe('live');
    expect(asked).toContain('2026-11-30:SERVICE');
    expect(asked).toContain('2026-11-23:TAG');
  });
});
