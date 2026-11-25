import { describe, expect, it } from 'vitest';
import { computeMetrics, parseIncidents } from '../src/metrics.js';

const H = 3_600_000;
const base = Date.parse('2026-03-01T00:00:00Z');
const at = (hours: number): string => new Date(base + hours * H).toISOString();

describe('AC-10 metrics', () => {
  it('computes median and p90 hours to publish and the share with a postmortem', () => {
    const incidents = parseIncidents(
      JSON.stringify([
        { id: 'a', closed_at: at(0), postmortem_published_at: at(24) },
        { id: 'b', closed_at: at(10), postmortem_published_at: at(58) },
        { id: 'c', closed_at: at(20), postmortem_published_at: at(92) },
        { id: 'd', closed_at: at(30), postmortem_published_at: null },
        { id: 'e', closed_at: null, postmortem_published_at: null },
      ]),
    );
    expect(computeMetrics(incidents)).toEqual({
      closed: 4,
      withPostmortem: 3,
      pctWithPostmortem: 75,
      hoursToPublish: { n: 3, median: 48, p90: 72 },
    });
  });

  it('reports nulls when nothing is closed or published', () => {
    expect(computeMetrics([])).toEqual({
      closed: 0,
      withPostmortem: 0,
      pctWithPostmortem: null,
      hoursToPublish: { n: 0, median: null, p90: null },
    });
    const none = parseIncidents(JSON.stringify([{ id: 'a', closed_at: at(0) }]));
    expect(computeMetrics(none).pctWithPostmortem).toBe(0);
    expect(computeMetrics(none).hoursToPublish.median).toBeNull();
  });

  it('rejects a postmortem published before the incident closed, or on an open incident', () => {
    const early = JSON.stringify([{ id: 'a', closed_at: at(10), postmortem_published_at: at(5) }]);
    expect(() => parseIncidents(early)).toThrow(/incidents\.json.*a/);
    const open = JSON.stringify([{ id: 'b', closed_at: null, postmortem_published_at: at(5) }]);
    expect(() => parseIncidents(open)).toThrow(/b/);
    expect(() => parseIncidents('{')).toThrow(/incidents\.json/);
  });
});
