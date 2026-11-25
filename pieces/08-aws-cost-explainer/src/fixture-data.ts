import type { AnalysisInput } from './analysis.ts';
import type { Anomaly, AnalysisConfig, CostRow, DateRange } from './types.ts';
import { UNTAGGED } from './types.ts';

/**
 * Made-up spend for one week and the week before. Not anyone's real bill. Tests, the demo and the
 * Lambda's default fixture mode all read this.
 */
export interface FixtureSnapshot {
  ranges: { previous: DateRange; current: DateRange };
  tagKey: string;
  services: { previous: CostRow[]; current: CostRow[] };
  tags: { previous: CostRow[]; current: CostRow[] };
  anomalies: Anomaly[];
}

const rows = (entries: [string, number][]): CostRow[] =>
  entries.map(([key, amount]) => ({ key, amount }));

export const FIXTURE: FixtureSnapshot = {
  ranges: {
    previous: { start: '2026-11-09', end: '2026-11-16' },
    current: { start: '2026-11-16', end: '2026-11-23' },
  },
  tagKey: 'team',
  services: {
    previous: rows([
      ['Amazon Elastic Compute Cloud - Compute', 1420],
      ['Amazon Relational Database Service', 610],
      ['Amazon Simple Storage Service', 180],
      ['EC2 - Other', 120],
      ['AmazonCloudWatch', 85],
      ['Amazon DynamoDB', 70],
      ['AWS Lambda', 40],
    ]),
    current: rows([
      ['Amazon Elastic Compute Cloud - Compute', 1465],
      ['Amazon Relational Database Service', 640],
      ['Amazon Simple Storage Service', 205],
      ['EC2 - Other', 390],
      ['AmazonCloudWatch', 60],
      ['Amazon DynamoDB', 71],
      ['AWS Lambda', 95],
      ['Amazon OpenSearch Service', 310],
    ]),
  },
  tags: {
    previous: rows([
      ['platform', 1500],
      ['data', 560],
      ['web', 330],
      [UNTAGGED, 135],
    ]),
    current: rows([
      ['platform', 1580],
      ['data', 960],
      ['web', 400],
      [UNTAGGED, 296],
    ]),
  },
  anomalies: [
    {
      id: 'fixture-anomaly-0001',
      service: 'EC2 - Other',
      startDate: '2026-11-17',
      totalImpact: 252.4,
      rootCauses: ['NatGateway-Bytes in us-east-1'],
    },
    {
      id: 'fixture-anomaly-0002',
      service: 'Amazon OpenSearch Service',
      startDate: '2026-11-18',
      totalImpact: 301.1,
      rootCauses: ['ESInstance:r6g.large in us-east-1'],
    },
  ],
};

/** The moment the fixture's report is "run": a Monday morning after the fixture week. */
export const FIXTURE_NOW = new Date('2026-11-23T08:00:00Z');

export const FIXTURE_CONFIG: AnalysisConfig = {
  minDeltaUsd: 25,
  minDeltaPct: 20,
  expectedChanges: ['AWS Lambda'],
};

/** A fresh, mutable copy, so a test can change one field without touching the others. */
export function fixtureAnalysisInput(): AnalysisInput {
  return {
    ranges: structuredClone(FIXTURE.ranges),
    tagKey: FIXTURE.tagKey,
    services: structuredClone(FIXTURE.services),
    tags: structuredClone(FIXTURE.tags),
    anomalies: structuredClone(FIXTURE.anomalies),
    reportDate: FIXTURE_NOW.toISOString().slice(0, 10),
    config: { ...FIXTURE_CONFIG, expectedChanges: [...FIXTURE_CONFIG.expectedChanges] },
  };
}
