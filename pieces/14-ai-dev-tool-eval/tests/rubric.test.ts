import { describe, expect, it } from 'vitest';
import { parseWeights } from '../src/schema.ts';
import { readPiece } from './helpers.ts';

const GROUPS = [
  'Data handling and security',
  'Admin and governance controls',
  'Audit logging',
  'Cost',
  'Measured productivity',
];

interface RubricRow {
  id: string;
  name: string;
  weight: string;
  gate: string;
  levels: string[];
  group: string;
}

/** Parses the criterion rows of RUBRIC.md, tagging each with the group heading above it. */
function rubricRows(markdown: string): RubricRow[] {
  const rows: RubricRow[] = [];
  let group = '';
  for (const line of markdown.split('\n')) {
    const heading = /^## (.+) \(group weight \d+\)$/.exec(line);
    if (heading?.[1]) {
      group = heading[1];
      continue;
    }
    const match = /^\|\s*([A-Z]\d+)\s*\|/.exec(line);
    if (!match) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    rows.push({
      id: cells[0] ?? '',
      name: cells[1] ?? '',
      weight: cells[2] ?? '',
      gate: cells[3] ?? '',
      levels: cells.slice(4, 8),
      group,
    });
  }
  return rows;
}

describe('AC1: rubric shape', () => {
  it('has the five groups, each criterion has levels 0 to 3 and a weight, and weights sum to 100', () => {
    const criteria = parseWeights(JSON.parse(readPiece('weights.json')));
    expect(new Set(criteria.map((c) => c.group))).toEqual(new Set(GROUPS));
    expect(criteria.every((c) => c.weight > 0)).toBe(true);
    const total = criteria.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBe(100);

    const rows = rubricRows(readPiece('RUBRIC.md'));
    expect(rows.length).toBe(criteria.length);
    for (const row of rows) {
      expect(row.levels).toHaveLength(4);
      for (const level of row.levels) expect(level.length).toBeGreaterThan(10);
    }
  });

  it('gives every group a heading whose weight matches the sum of its criteria', () => {
    const markdown = readPiece('RUBRIC.md');
    const criteria = parseWeights(JSON.parse(readPiece('weights.json')));
    for (const group of GROUPS) {
      const heading = new RegExp(`^## ${group} \\(group weight (\\d+)\\)$`, 'm').exec(markdown);
      expect(heading, `heading for ${group}`).not.toBeNull();
      const sum = criteria
        .filter((c) => c.group === group)
        .reduce((total, c) => total + c.weight, 0);
      expect(Number(heading?.[1])).toBe(sum);
    }
  });
});

describe('AC2: RUBRIC.md and weights.json agree', () => {
  it('lists each criterion once, with the same name, group, weight and gate flag', () => {
    const criteria = parseWeights(JSON.parse(readPiece('weights.json')));
    const rows = rubricRows(readPiece('RUBRIC.md'));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);

    for (const criterion of criteria) {
      const row = rows.find((r) => r.id === criterion.id);
      expect(row, `row for ${criterion.id}`).toBeDefined();
      expect(row?.name).toBe(criterion.name);
      expect(row?.group).toBe(criterion.group);
      expect(row?.weight).toBe(String(criterion.weight));
      expect(row?.gate).toBe(criterion.gate ? 'yes' : 'no');
    }
  });
});
