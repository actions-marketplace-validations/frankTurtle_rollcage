import { describe, expect, it } from 'vitest';
import { analyze, weekRanges } from '../src/analysis.ts';
import { fixtureAnalysisInput } from '../src/fixture-data.ts';
import { UNTAGGED } from '../src/types.ts';
import { must } from './helpers.ts';

const run = () => analyze(fixtureAnalysisInput());
const svc = (name: string) => must(run().services.find((r) => r.key === name));

describe('AC-1 deltas by service and tag are computed in code', () => {
  it('totals the two weeks', () => {
    const a = run();
    expect(a.totals).toEqual({ previous: 2525, current: 3236, delta: 711, pct: 28.2 });
  });

  it('gives previous, current, change and percent per service, largest change first', () => {
    const a = run();
    expect(a.services.slice(0, 3).map((r) => r.key)).toEqual([
      'Amazon OpenSearch Service',
      'EC2 - Other',
      'AWS Lambda',
    ]);
    expect(svc('EC2 - Other')).toMatchObject({
      previous: 120,
      current: 390,
      delta: 270,
      pct: 225,
    });
  });

  it('does the same by tag value', () => {
    const a = run();
    expect(a.tagKey).toBe('team');
    expect(a.tags.find((r) => r.key === 'data')).toMatchObject({ delta: 400, pct: 71.4 });
  });

  it('computes the week ranges from the report time, end exclusive', () => {
    expect(weekRanges(new Date('2026-11-23T08:00:00Z'))).toEqual({
      current: { start: '2026-11-16', end: '2026-11-23' },
      previous: { start: '2026-11-09', end: '2026-11-16' },
    });
  });
});

describe('AC-2 materiality needs both thresholds; new spend needs the dollar one', () => {
  it('ignores small percent changes and small dollar changes', () => {
    expect(svc('Amazon Simple Storage Service').material).toBe(false);
    expect(svc('Amazon Elastic Compute Cloud - Compute').material).toBe(false);
  });

  it('marks new spend with a null percent', () => {
    expect(svc('Amazon OpenSearch Service')).toMatchObject({
      previous: 0,
      pct: null,
      isNew: true,
      material: true,
    });
  });

  it('flags material decreases as material', () => {
    expect(svc('AmazonCloudWatch')).toMatchObject({ delta: -25, material: true });
  });

  it('does not call a tiny new service material', () => {
    const input = fixtureAnalysisInput();
    input.services.current.push({ key: 'AWS Tiny', amount: 2 });
    const row = must(analyze(input).services.find((r) => r.key === 'AWS Tiny'));
    expect(row).toMatchObject({ isNew: true, material: false });
  });
});

describe('AC-3 untagged spend', () => {
  it('is reported as (untagged) and exposed on its own', () => {
    const a = run();
    expect(UNTAGGED).toBe('(untagged)');
    expect(a.untagged).toMatchObject({ key: UNTAGGED, previous: 135, current: 296, delta: 161 });
  });

  it('is null when every cost is tagged', () => {
    const input = fixtureAnalysisInput();
    input.tags.previous = input.tags.previous.filter((r) => r.key !== UNTAGGED);
    input.tags.current = input.tags.current.filter((r) => r.key !== UNTAGGED);
    expect(analyze(input).untagged).toBeNull();
  });
});

describe('AC-4 unexplained spend', () => {
  it('sums material increases that are not on the expected list', () => {
    const a = run();
    expect(a.unexplained.amount).toBe(580);
    expect(a.unexplained.share).toBe(17.9);
    expect(a.unexplained.services).toEqual(['Amazon OpenSearch Service', 'EC2 - Other']);
  });

  it('leaves out expected increases and decreases', () => {
    expect(svc('AWS Lambda')).toMatchObject({ material: true, unexplained: false });
    expect(svc('AmazonCloudWatch').unexplained).toBe(false);
  });

  it('counts the Lambda increase too once it is no longer expected', () => {
    const input = fixtureAnalysisInput();
    input.config.expectedChanges = [];
    expect(analyze(input).unexplained.amount).toBe(635);
  });

  it('is zero with no spend at all', () => {
    const input = fixtureAnalysisInput();
    input.services = { previous: [], current: [] };
    input.tags = { previous: [], current: [] };
    const a = analyze(input);
    expect(a.unexplained).toEqual({ amount: 0, share: 0, services: [] });
    expect(a.totals.pct).toBeNull();
  });
});

describe('AC-5 time to notice an anomaly', () => {
  it('counts whole days from start date to report date, and to month end', () => {
    const a = run();
    const ec2 = must(a.anomalies.find((x) => x.service === 'EC2 - Other'));
    const os = must(a.anomalies.find((x) => x.service === 'Amazon OpenSearch Service'));
    expect([ec2.daysToNotice, ec2.daysToMonthEnd]).toEqual([6, 13]);
    expect([os.daysToNotice, os.daysToMonthEnd]).toEqual([5, 12]);
  });

  it('links anomalies to the service rows they explain', () => {
    expect(svc('EC2 - Other').anomalyIds).toHaveLength(1);
    expect(svc('AWS Lambda').anomalyIds).toEqual([]);
  });
});
