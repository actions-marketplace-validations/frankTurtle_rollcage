import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import type { Finding } from './types.js';
import type { SymbolHints } from './symbols.js';

/**
 * There is deliberately no "not reachable" verdict. A text search can show that code mentions a
 * package; it cannot show that code never does.
 */
export const VERDICTS = ['import-and-symbol-found', 'import-found', 'unknown'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Evidence {
  kind: 'import' | 'symbol';
  file: string;
  line: number;
  /** `file:line`, relative to the app source directory. */
  ref: string;
  text: string;
  /** For a symbol hit: the advisory function names found on the line. */
  matched?: string[];
}

export interface Reachability {
  verdict: Verdict;
  evidence: Evidence[];
}

export interface SourceFile {
  rel: string;
  lines: string[];
}

export interface SourceIndex {
  root: string;
  files: SourceFile[];
}

const NODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const PY_EXT = new Set(['.py']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__']);
const MAX_TEXT = 160;

/** Read every source file under `root` once. A missing directory gives an empty index. */
export function buildSourceIndex(root: string): SourceIndex {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
      } else if (NODE_EXT.has(extname(entry.name)) || PY_EXT.has(extname(entry.name))) {
        files.push({
          rel: relative(root, path).split(sep).join('/'),
          lines: readFileSync(path, 'utf8').split(/\r?\n/),
        });
      }
    }
  };
  if (existsSync(root)) walk(root);
  return { root, files };
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Python import names that differ from the distribution name. */
const PY_MODULE_ALIASES: Record<string, string> = {
  pyyaml: 'yaml',
  pillow: 'PIL',
  beautifulsoup4: 'bs4',
  'python-dateutil': 'dateutil',
  'scikit-learn': 'sklearn',
  'opencv-python': 'cv2',
};

const pyModule = (pkg: string): string => {
  const lower = pkg.toLowerCase();
  return PY_MODULE_ALIASES[lower] ?? lower.replace(/-/g, '_');
};

function nodeImport(pkg: string): RegExp {
  return new RegExp(
    `(?:require\\(\\s*|from\\s+|import\\s+|import\\(\\s*)['"]${escape(pkg)}(?:/[^'"]*)?['"]`,
  );
}

function pyImport(pkg: string): RegExp {
  const mod = escape(pyModule(pkg));
  const dotted = `${mod}(?:\\.[\\w.]+)?`;
  return new RegExp(
    `^\\s*(?:from\\s+${dotted}\\s+import\\b|import\\s+(?:[\\w.]+(?:\\s+as\\s+\\w+)?\\s*,\\s*)*${dotted}(?:\\s+as\\s+\\w+)?\\s*(?:,|$|#))`,
  );
}

const symbolRegex = (symbol: string): RegExp =>
  new RegExp(`(?<![\\w$])${escape(symbol)}(?![\\w$])`);

const clip = (line: string): string => {
  const t = line.trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}...` : t;
};

/** Search the indexed source for imports of the finding's package and its advisory functions. */
export function findEvidence(
  finding: Finding,
  index: SourceIndex,
  symbols: SymbolHints,
): Reachability {
  const hints = symbols[finding.id] ?? (finding.cve ? symbols[finding.cve] : undefined) ?? [];
  const hintRegexes = hints.map((name) => [name, symbolRegex(name)] as const);
  const evidence: Evidence[] = [];
  for (const file of index.files) {
    const isPy = PY_EXT.has(extname(file.rel));
    if (isPy ? finding.ecosystem === 'npm' : finding.ecosystem === 'pypi') continue;
    const importRe = isPy ? pyImport(finding.package) : nodeImport(finding.package);
    const importLines = new Set<number>();
    const hits: Evidence[] = [];
    file.lines.forEach((text, i) => {
      if (importRe.test(text)) {
        importLines.add(i);
        hits.push(entry('import', file.rel, i + 1, text));
      }
    });
    if (importLines.size === 0) continue;
    file.lines.forEach((text, i) => {
      if (importLines.has(i)) return;
      const matched = hintRegexes.filter(([, re]) => re.test(text)).map(([name]) => name);
      if (matched.length > 0) hits.push({ ...entry('symbol', file.rel, i + 1, text), matched });
    });
    evidence.push(...hits.sort((a, b) => a.line - b.line));
  }
  const hasImport = evidence.some((e) => e.kind === 'import');
  const hasSymbol = evidence.some((e) => e.kind === 'symbol');
  const verdict: Verdict = !hasImport
    ? 'unknown'
    : hasSymbol
      ? 'import-and-symbol-found'
      : 'import-found';
  return { verdict, evidence };
}

function entry(kind: Evidence['kind'], file: string, line: number, text: string): Evidence {
  return { kind, file, line, ref: `${file}:${line}`, text: clip(text) };
}
