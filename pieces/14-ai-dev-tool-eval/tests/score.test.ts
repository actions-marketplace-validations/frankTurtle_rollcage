import { describe, expect, it } from 'vitest';
import { parseScorecard, rankTools, weightedScore } from '../src/score.ts';
import { parseWeights, type Criterion } from '../src/schema.ts';
import { readPiece } from './helpers.ts';

const weightsJson = JSON.parse(readPiece('weights.json'));
const realCriteria = parseWeights(weightsJson);

/** Two criteria, weights 1 and 3, no gates. Max raw is 3 * 4 = 12. */
const small: Criterion[] = [
  { id: 'A1', group: 'G', name: 'first', weight: 1, gate: false },
  { id: 'B1', group: 'G', name: 'second', weight: 3, gate: false },
];

function table(csv: string, criteria: Criterion[] = small) {
  return parseScorecard(csv, criteria);
}

describe('AC4: weighted scores', () => {
  it('matches hand-computed values on a small fixture', () => {
    // Tool X: raw = 1*3 + 3*1 = 6, score = 100 * 6 / 12 = 50.
    // Tool Y: raw = 1*0 + 3*3 = 9, score = 100 * 9 / 12 = 75.
    const t = table('criterion_id,Tool X,Tool Y\nA1,3,0\nB1,1,3');
    const ranked = rankTools(small, t);
    const byName = Object.fromEntries(ranked.map((r) => [r.tool, r.score]));
    expect(byName['Tool X']).toBeCloseTo(50, 2);
    expect(byName['Tool Y']).toBeCloseTo(75, 2);
  });

  it('computes weightedScore directly from a score map', () => {
    expect(weightedScore(small, { A1: 3, B1: 1 })).toBeCloseTo(50, 6);
    expect(weightedScore(small, { A1: 0, B1: 0 })).toBe(0);
    expect(weightedScore(small, { A1: 3, B1: 3 })).toBe(100);
  });

  it('gives the example scorecard the totals hand-computed from its weights', () => {
    const ranked = rankTools(
      realCriteria,
      parseScorecard(readPiece('scorecard.example.csv'), realCriteria),
    );
    const byName = Object.fromEntries(ranked.map((r) => [r.tool, r.score]));
    // Raw sums over 100 weight points at 3 points per level: 181, 177 and 155 out of 300.
    expect(byName['Tool A']).toBe(60.33);
    expect(byName['Tool B']).toBe(59);
    expect(byName['Tool C']).toBe(51.67);
  });
});

describe('AC6: gates block a tool', () => {
  it('ranks a blocked tool below every unblocked tool, whatever its total', () => {
    const gated: Criterion[] = [
      { id: 'A1', group: 'G', name: 'gate', weight: 1, gate: true },
      { id: 'B1', group: 'G', name: 'other', weight: 9, gate: false },
    ];
    // Blocked has the higher total (90 against 70) but scores 0 on the gate.
    const t = table('criterion_id,Blocked,Passing\nA1,0,3\nB1,3,2', gated);
    const ranked = rankTools(gated, t);
    expect(ranked.map((r) => r.tool)).toEqual(['Passing', 'Blocked']);
    const blocked = ranked[1];
    expect(blocked?.blocked).toBe(true);
    expect(blocked?.blockedBy).toEqual(['A1']);
    expect(ranked[0]?.blocked).toBe(false);
    expect(ranked[0]?.rank).toBe(1);
    expect(blocked?.rank).toBe(2);
  });

  it('does not block a tool that scores 0 on a criterion that is not a gate', () => {
    const t = table('criterion_id,Tool A,Tool B\nA1,0,3\nB1,0,3');
    const ranked = rankTools(small, t);
    expect(ranked.every((r) => !r.blocked)).toBe(true);
  });
});

describe('AC7: deterministic ranking', () => {
  it('sorts equal scores by tool name, whatever the column order', () => {
    const forward = table('criterion_id,Beta,Alpha\nA1,2,2\nB1,2,2');
    const reversed = table('criterion_id,Alpha,Beta\nA1,2,2\nB1,2,2');
    const names = (csv: ReturnType<typeof table>) => rankTools(small, csv).map((r) => r.tool);
    expect(names(forward)).toEqual(['Alpha', 'Beta']);
    expect(names(reversed)).toEqual(['Alpha', 'Beta']);
  });

  it('gives the same output on repeated runs', () => {
    const t = table(readPiece('scorecard.example.csv'), realCriteria);
    expect(rankTools(realCriteria, t)).toEqual(rankTools(realCriteria, t));
  });
});
