import { describe, expect, it } from 'vitest';
import { ScorecardError, parseScorecard } from '../src/score.ts';
import { WeightsError, parseWeights } from '../src/schema.ts';
import { readPiece } from './helpers.ts';

const criteria = parseWeights(JSON.parse(readPiece('weights.json')));
const example = readPiece('scorecard.example.csv');

/** Every criterion scored 1 for each tool in the header. */
function fullCsv(header: string, overrides: Record<string, string> = {}): string {
  const tools = header.split(',').length - 1;
  const rows = criteria.map((c) => {
    const cells = Array.from({ length: tools }, () => '1');
    return [c.id, ...(overrides[c.id] ? [overrides[c.id]] : cells)].join(',');
  });
  return [header, ...rows].join('\n');
}

function scorecardErrors(csv: string): string[] {
  try {
    parseScorecard(csv, criteria);
  } catch (err) {
    if (err instanceof ScorecardError) return err.errors;
    throw err;
  }
  return [];
}

describe('AC3: the example scorecard', () => {
  it('validates, uses placeholder tool names only, and scores every criterion', () => {
    const table = parseScorecard(example, criteria);
    expect(table.tools).toEqual(['Tool A', 'Tool B', 'Tool C']);
    for (const tool of table.tools) expect(tool).toMatch(/^Tool [A-Z]$/);
    for (const tool of table.tools) {
      expect(Object.keys(table.scores[tool] ?? {}).sort()).toEqual(
        criteria.map((c) => c.id).sort(),
      );
    }
  });
});

describe('AC5: validation rejects bad input', () => {
  const header = 'criterion_id,Tool A,Tool B';

  it('accepts a complete, valid scorecard', () => {
    expect(scorecardErrors(fullCsv(header))).toEqual([]);
  });

  it.each([
    ['a missing score', fullCsv(header, { A1: '2,' }), /A1.*missing score/],
    ['a score above 3', fullCsv(header, { A1: '4,1' }), /A1.*integer from 0 to 3/],
    ['a fractional score', fullCsv(header, { A1: '1.5,1' }), /A1.*integer from 0 to 3/],
    ['a non-numeric score', fullCsv(header, { A1: 'x,1' }), /A1.*integer from 0 to 3/],
    ['an unknown criterion', `${fullCsv(header)}\nZ9,1,1`, /unknown criterion Z9/],
    ['a duplicate criterion row', `${fullCsv(header)}\nA1,1,1`, /duplicate criterion A1/],
    [
      'a missing criterion row',
      fullCsv(header)
        .split('\n')
        .filter((l) => !l.startsWith('A1,'))
        .join('\n'),
      /missing criterion A1/,
    ],
    [
      'a duplicate tool name',
      fullCsv('criterion_id,Tool A,Tool A'),
      /duplicate tool name "Tool A"/,
    ],
    [
      'a header whose first column is not criterion_id',
      fullCsv('criteria,Tool A,Tool B'),
      /first column must be criterion_id/,
    ],
    [
      'a row with the wrong number of cells',
      fullCsv(header).replace('A1,1,1', 'A1,1'),
      /expected 3 cells/,
    ],
    ['no tool columns', fullCsv('criterion_id'), /no tools/],
    ['an empty tool name', fullCsv('criterion_id, ,Tool B'), /empty tool name/],
    ['no criterion rows', 'criterion_id,Tool A', /missing criterion/],
  ])('rejects %s', (_label, csv, pattern) => {
    const errors = scorecardErrors(csv);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => pattern.test(e))).toBe(true);
  });

  it('reports every problem it finds, not just the first', () => {
    // A1: two out-of-range scores. B1: a blank score for Tool A.
    const errors = scorecardErrors(fullCsv(header, { A1: '9,9', B1: ',1' }));
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects weights that are zero, negative, duplicated or malformed', () => {
    const base = JSON.parse(readPiece('weights.json')) as {
      criteria: Array<Record<string, unknown>>;
    };
    const withCriterion = (patch: Record<string, unknown>, index = 0) => ({
      version: 1,
      criteria: base.criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    });
    expect(() => parseWeights(withCriterion({ weight: 0 }))).toThrow(WeightsError);
    expect(() => parseWeights(withCriterion({ weight: -2 }))).toThrow(WeightsError);
    expect(() => parseWeights(withCriterion({ gate: undefined }))).toThrow(WeightsError);
    expect(() => parseWeights(withCriterion({ id: 'a1' }))).toThrow(WeightsError);
    expect(() => parseWeights({ version: 2, criteria: base.criteria })).toThrow(WeightsError);
    expect(() => parseWeights({ version: 1, criteria: [] })).toThrow(WeightsError);
    expect(() =>
      parseWeights({ version: 1, criteria: [base.criteria[0], base.criteria[0]] }),
    ).toThrow(/duplicate criterion id A1/);
  });
});
