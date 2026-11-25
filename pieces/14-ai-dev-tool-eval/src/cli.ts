import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Fetcher, checkLinks, listMarkdownFiles } from './links.ts';
import { parseWeights } from './schema.ts';
import { ScorecardError, parseScorecard, rankTools, type ToolResult } from './score.ts';

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export interface Deps {
  /** Replaces the live fetch. Tests inject a fake so no request leaves the machine. */
  fetcher?: Fetcher | undefined;
}

const LIVE_TIMEOUT_MS = 10_000;

const USAGE = `Usage:
  ai-dev-tool-eval score [--root DIR] [--scorecard FILE] [--weights FILE] [--out FILE]
  ai-dev-tool-eval links [--root DIR] [--live]
Defaults: --root is the current folder, --scorecard scorecard.example.csv, --weights weights.json.
--out writes JSON. --live fetches external links; without it they are only counted.`;

/** The flags either command can take. Each command reads only its own. */
interface Flags {
  root?: string;
  scorecard?: string;
  weights?: string;
  out?: string;
  live?: boolean;
}

const OPTIONS = {
  score: {
    root: { type: 'string' },
    scorecard: { type: 'string' },
    weights: { type: 'string' },
    out: { type: 'string' },
  },
  links: {
    root: { type: 'string' },
    live: { type: 'boolean' },
  },
} as const;

const defaultFetcher: Fetcher = async (url) => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
  });
  await response.body?.cancel();
  return { status: response.status };
};

/** Reads and parses a JSON file. A bad file names itself in the error. */
function readJson(path: string, label: string): unknown {
  const text = readFileSync(path, 'utf8');
  try {
    return JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${label} ${path} is not valid JSON: ${detail}`);
  }
}

function printRanking(results: ToolResult[], io: Io): void {
  io.out('Rank  Tool      Score  Status');
  for (const r of results) {
    const status = r.blocked ? `blocked by gate ${r.blockedBy.join(', ')}` : 'not blocked';
    io.out(
      `${String(r.rank).padEnd(6)}${r.tool.padEnd(10)}${r.score.toFixed(2).padEnd(7)}${status}`,
    );
  }
  const blocked = results.filter((r) => r.blocked);
  io.out(
    blocked.length === 0
      ? 'Blocked by a gate: none'
      : `Blocked by a gate: ${blocked.map((r) => `${r.tool} (${r.blockedBy.join(', ')})`).join('; ')}`,
  );
}

function runScore(root: string, values: Flags, io: Io): number {
  const weightsPath = resolve(root, String(values.weights ?? 'weights.json'));
  const scorecardPath = resolve(root, String(values.scorecard ?? 'scorecard.example.csv'));
  const criteria = parseWeights(readJson(weightsPath, 'weights file'));
  const table = parseScorecard(readFileSync(scorecardPath, 'utf8'), criteria);
  const results = rankTools(criteria, table);
  printRanking(results, io);

  const out = values.out;
  if (typeof out === 'string') {
    const outPath = resolve(root, out);
    mkdirSync(dirname(outPath), { recursive: true });
    const json = {
      schemaVersion: 1,
      scorecard: basename(scorecardPath),
      weights: basename(weightsPath),
      results,
    };
    writeFileSync(outPath, `${JSON.stringify(json, null, 2)}\n`);
    io.out(`Wrote ${outPath}`);
  }
  return 0;
}

async function runLinks(root: string, values: Flags, io: Io, deps: Deps): Promise<number> {
  const live = values.live === true;
  const report = await checkLinks({
    root,
    files: listMarkdownFiles(root),
    live,
    fetcher: live ? (deps.fetcher ?? defaultFetcher) : undefined,
  });

  io.out(`relative and anchor links checked: ${report.checked}`);
  io.out(
    live
      ? `external links checked live: ${report.external}`
      : `external links skipped (offline): ${report.skipped}`,
  );
  for (const b of report.broken) io.err(`${b.file}:${b.line}: ${b.target}: ${b.reason}`);
  if (report.broken.length > 0) {
    io.err(`${report.broken.length} broken link(s)`);
    return 1;
  }
  return 0;
}

/**
 * Runs the piece's command line. Returns the exit code: 0 on success, 1 on invalid input or
 * broken links, 2 on a usage error.
 */
export async function runCli(argv: string[], io: Io, deps: Deps = {}): Promise<number> {
  const [command, ...args] = argv;
  if (command !== 'score' && command !== 'links') {
    io.err(USAGE);
    return 2;
  }

  let values: Flags;
  try {
    values = parseArgs({ args, options: OPTIONS[command], strict: true }).values as Flags;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    io.err(USAGE);
    return 2;
  }

  const root = resolve(String(values.root ?? process.cwd()));
  try {
    return command === 'score'
      ? runScore(root, values, io)
      : await runLinks(root, values, io, deps);
  } catch (err) {
    if (err instanceof ScorecardError) {
      for (const line of err.errors) io.err(`scorecard: ${line}`);
    } else {
      io.err(err instanceof Error ? err.message : String(err));
    }
    return 1;
  }
}
