import { describe, expect, it } from 'vitest';
import { analyze } from '../src/analysis.ts';
import { fixtureAnalysisInput } from '../src/fixture-data.ts';
import { computeMetrics, formatMetrics } from '../src/metrics.ts';

describe('metrics', () => {
  const analysis = analyze(fixtureAnalysisInput());

  it('reports unexplained spend and time to notice', () => {
    expect(computeMetrics(analysis)).toEqual({
      unexplainedUsd: 580,
      unexplainedSharePct: 17.9,
      anomalies: [
        { service: 'EC2 - Other', daysToNotice: 6, daysToMonthEnd: 13 },
        { service: 'Amazon OpenSearch Service', daysToNotice: 5, daysToMonthEnd: 12 },
      ],
      medianDaysToNotice: 5.5,
      medianDaysToMonthEnd: 12.5,
    });
  });

  it('prints the numbers labeled as fixture data', () => {
    const text = formatMetrics(computeMetrics(analysis), 'fixture data').join('\n');
    expect(text).toContain('fixture data');
    expect(text).toContain('$580');
    expect(text).toContain('6 days');
  });

  it('prints a clear line when there are no anomalies', () => {
    const input = fixtureAnalysisInput();
    input.anomalies = [];
    const m = computeMetrics(analyze(input));
    expect(m.medianDaysToNotice).toBeNull();
    expect(formatMetrics(m, 'fixture data').join('\n')).toContain('No anomalies');
  });
});
