import { z } from 'zod';

/** Vulnerability id to the function names its advisory points at. */
export type SymbolHints = Record<string, string[]>;

/** Keys starting with an underscore are notes, not hints. */
export function parseSymbols(json: unknown): SymbolHints {
  const raw = z.record(z.string(), z.unknown()).parse(json);
  const hints: SymbolHints = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!id.startsWith('_')) hints[id] = z.array(z.string()).parse(value);
  }
  return hints;
}
