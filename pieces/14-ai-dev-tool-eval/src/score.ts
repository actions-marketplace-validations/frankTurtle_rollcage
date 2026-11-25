import { z } from 'zod';
import type { Criterion } from './schema.ts';

/** The highest level a criterion can score. */
export const MAX_LEVEL = 3;

const ScoreCell = z.enum(['0', '1', '2', '3']);

/** Scores by tool, then by criterion ID. Complete: every tool scores every criterion. */
export interface ScoreTable {
  tools: string[];
  scores: Record<string, Record<string, number>>;
}

export interface ToolResult {
  tool: string;
  /** Weighted score from 0 to 100, rounded to two decimals. */
  score: number;
  blocked: boolean;
  blockedBy: string[];
  /** 1 is the best position. Blocked tools always come after unblocked ones. */
  rank: number;
}

export class ScorecardError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`scorecard is invalid:\n  ${errors.join('\n  ')}`);
    this.name = 'ScorecardError';
    this.errors = errors;
  }
}

/**
 * Parses and validates a scorecard CSV: criterion_id in the first column, one tool per column.
 * Reports every problem it finds, not just the first. A blank cell is an error, never a zero.
 */
export function parseScorecard(csv: string, criteria: Criterion[]): ScoreTable {
  const errors: string[] = [];
  const known = new Set(criteria.map((c) => c.id));
  const lines = csv.split(/\r?\n/).filter((line) => line.trim() !== '');
  const [headerLine = '', ...rowLines] = lines;
  const header = headerLine.split(',').map((cell) => cell.trim());

  if (header[0] !== 'criterion_id') errors.push('first column must be criterion_id');
  const tools = header.slice(1);
  if (tools.length === 0) errors.push('no tools: add at least one tool column after criterion_id');

  const seenTools = new Set<string>();
  for (const tool of tools) {
    if (tool === '') errors.push('empty tool name in the header');
    else if (seenTools.has(tool)) errors.push(`duplicate tool name "${tool}"`);
    seenTools.add(tool);
  }

  const scores: Record<string, Record<string, number>> = {};
  for (const tool of tools) scores[tool] = {};
  const seenRows = new Set<string>();

  rowLines.forEach((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim());
    const id = cells[0] ?? '';
    const where = `row ${index + 2}`;
    if (cells.length !== header.length) {
      errors.push(
        `${where} (${id || 'blank'}): expected ${header.length} cells, found ${cells.length}`,
      );
      return;
    }
    if (!known.has(id)) {
      errors.push(`${where}: unknown criterion ${id || '(blank)'}`);
      return;
    }
    if (seenRows.has(id)) {
      errors.push(`${where}: duplicate criterion ${id}`);
      return;
    }
    seenRows.add(id);
    tools.forEach((tool, i) => {
      const raw = cells[i + 1] ?? '';
      const row = scores[tool];
      if (raw === '') {
        errors.push(`criterion ${id} for ${tool}: missing score`);
        return;
      }
      const parsed = ScoreCell.safeParse(raw);
      if (!parsed.success) {
        errors.push(
          `criterion ${id} for ${tool}: score must be an integer from 0 to 3, got "${raw}"`,
        );
        return;
      }
      if (row) row[id] = Number(parsed.data);
    });
  });

  for (const id of known) {
    if (!seenRows.has(id)) errors.push(`missing criterion ${id}`);
  }

  if (errors.length > 0) throw new ScorecardError(errors);
  return { tools, scores };
}

/** Weighted score from 0 to 100: 100 * sum(weight * score) / (MAX_LEVEL * sum(weight)). */
export function weightedScore(criteria: Criterion[], scores: Record<string, number>): number {
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const raw = criteria.reduce((sum, c) => {
    const score = scores[c.id];
    if (score === undefined) throw new Error(`no score for criterion ${c.id}`);
    return sum + c.weight * score;
  }, 0);
  return (100 * raw) / (MAX_LEVEL * totalWeight);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ranks tools. A tool is blocked when it scores 0 on any gate criterion. Unblocked tools come
 * first, by score descending; equal scores sort by tool name, so the order never depends on
 * column order.
 */
export function rankTools(criteria: Criterion[], table: ScoreTable): ToolResult[] {
  const gates = criteria.filter((c) => c.gate);
  const results = table.tools.map((tool) => {
    const scores = table.scores[tool] ?? {};
    const blockedBy = gates.filter((g) => scores[g.id] === 0).map((g) => g.id);
    return {
      tool,
      score: round2(weightedScore(criteria, scores)),
      blocked: blockedBy.length > 0,
      blockedBy,
    };
  });
  results.sort(
    (a, b) => Number(a.blocked) - Number(b.blocked) || b.score - a.score || byText(a.tool, b.tool),
  );
  return results.map((result, index) => ({ ...result, rank: index + 1 }));
}
