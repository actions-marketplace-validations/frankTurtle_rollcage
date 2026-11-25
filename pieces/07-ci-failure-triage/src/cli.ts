import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { GitHubHttp, parseLlmMode, selectLlm } from '@adl/shared';
import type { FetchLike } from '@adl/shared';
import { loadConfig } from './config.js';
import type { TriageConfig } from './config.js';
import { GitHubRunSource } from './github-source.js';
import type { RunSource } from './github-source.js';
import { loadHistory, recordRuns, serializeHistory } from './history.js';
import type { History } from './history.js';
import { compareMetrics, computeMetrics, renderComparison, renderPeriod } from './metrics.js';
import { loadQuarantine, maintainerCommands, proposeQuarantine } from './quarantine.js';
import { renderMarkdown, renderText } from './report.js';
import type { TriageReport } from './report.js';
import { attemptKey, ms, parseRuns } from './runs.js';
import type { RunRecord } from './runs.js';
import { triageItem } from './triage.js';
import type { TriageItem } from './triage.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
  fetchImpl?: FetchLike;
}

const DAY_MS = 86_400_000;
/** How far back a GitHub triage looks when --since is not given. */
const DEFAULT_DAYS = 14;

const USAGE = `Usage:
  triage triage (--runs FILE | --repo OWNER/NAME | --log FILE ...)
         [--since YYYY-MM-DD] [--until YYYY-MM-DD]
         [--history FILE] [--update-history] [--quarantine FILE] [--config FILE]
         [--llm auto|live|replay|none] [--llm-fixtures DIR] [--out DIR]
  triage metrics --runs FILE [--since YYYY-MM-DD] [--until YYYY-MM-DD]
         [--compare-at YYYY-MM-DD] [--label TEXT] [--config FILE]
Dates are UTC. The range is [since, until). --repo needs GITHUB_TOKEN.`;

class UsageError extends Error {}

const read = (path: string, what: string): string => {
  if (!existsSync(path)) throw new UsageError(`${what} not found: ${path}`);
  return readFileSync(path, 'utf8');
};

function parseDay(value: string, flag: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d\d-\d\d$/.test(value) || Number.isNaN(d.getTime())) {
    throw new UsageError(`${flag} must be a date like 2026-03-01`);
  }
  return d;
}

const loadConfigFile = (path?: string): TriageConfig =>
  loadConfig(path ? read(path, 'config file') : undefined);

/** The path a patch should name: relative to the working directory when inside it, else the file name. */
function patchTarget(file: string | undefined, cwd: string): string {
  if (!file) return 'quarantine.json';
  const rel = isAbsolute(file) ? relative(cwd, file) : file;
  return rel.startsWith('..') || isAbsolute(rel) ? basename(file) : rel;
}

interface Loaded {
  source: TriageReport['source'];
  runs: RunRecord[];
  items: TriageItem[];
  skipped: TriageReport['skipped'];
}

type Flags = ReturnType<typeof parseTriageFlags>;

function parseTriageFlags(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      runs: { type: 'string' },
      repo: { type: 'string' },
      log: { type: 'string', multiple: true },
      since: { type: 'string' },
      until: { type: 'string' },
      history: { type: 'string' },
      'update-history': { type: 'boolean', default: false },
      quarantine: { type: 'string' },
      config: { type: 'string' },
      llm: { type: 'string', default: 'auto' },
      'llm-fixtures': { type: 'string' },
      out: { type: 'string' },
    },
  }).values;
}

/** Load failed runs and their logs from one of the three sources. Logs that cannot be had are skipped, with the reason. */
async function load(values: Flags, deps: CliDeps): Promise<Loaded> {
  const logs = values.log ?? [];
  if ([values.runs, values.repo, logs.length ? 'logs' : undefined].filter(Boolean).length !== 1) {
    throw new UsageError('give exactly one of --runs, --repo or --log');
  }
  if (logs.length) {
    const items = logs.map((path) => ({ id: path, log: read(path, 'log file') }));
    return { source: 'logs', runs: [], items, skipped: [] };
  }
  const skipped: Loaded['skipped'] = [];
  let runs: RunRecord[];
  let logFor: (run: RunRecord) => Promise<string | undefined>;
  let source: Loaded['source'];
  if (values.runs) {
    runs = parseRuns(read(values.runs, 'runs file'));
    const dir = dirname(values.runs);
    logFor = async (r) => (r.logFile ? read(join(dir, r.logFile), 'log file') : undefined);
    source = 'runs';
  } else {
    const [owner, name] = (values.repo ?? '').split('/');
    if (!owner || !name) throw new UsageError('--repo must look like OWNER/NAME');
    const token = deps.env['GITHUB_TOKEN'];
    if (!token) throw new UsageError('set GITHUB_TOKEN to read from GitHub');
    const github: RunSource = new GitHubRunSource(new GitHubHttp(token, deps.fetchImpl ?? fetch), {
      owner,
      name,
    });
    const until = values.until
      ? parseDay(values.until, '--until')
      : (deps.now ?? (() => new Date()))();
    const since = values.since
      ? parseDay(values.since, '--since')
      : new Date(until.getTime() - DEFAULT_DAYS * DAY_MS);
    runs = await github.listRuns({ since, until });
    logFor = (r) => github.failureLog(r);
    source = 'github';
  }
  const failed = runs
    .filter((r) => r.conclusion === 'failure')
    .sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const items = await Promise.all(
    failed.map(async (run): Promise<TriageItem | undefined> => {
      const id = `${run.id}#${run.attempt}`;
      try {
        const log = await logFor(run);
        if (log === undefined) skipped.push({ id, reason: 'no log file for this run' });
        else if (log.trim() === '') skipped.push({ id, reason: 'no failed job logs found' });
        else return { id, log, run };
      } catch (e) {
        skipped.push({
          id,
          reason: `log unavailable (${e instanceof Error ? e.message : 'error'})`,
        });
      }
      return undefined;
    }),
  );
  return { source, runs, items: items.filter((i): i is TriageItem => i !== undefined), skipped };
}

async function triage(argv: string[], deps: CliDeps): Promise<number> {
  const values = parseTriageFlags(argv);
  const config = loadConfigFile(values.config);
  const llm = selectLlm(parseLlmMode(values.llm), deps.env, values['llm-fixtures']);
  if (values['update-history'] && !values.history)
    throw new UsageError('--update-history needs --history FILE');
  const historyText =
    values.history && existsSync(values.history) ? readFileSync(values.history, 'utf8') : undefined;
  let history: History = loadHistory(historyText);

  const loaded = await load(values, deps);
  const runs = await Promise.all(
    loaded.items.map((item) => triageItem(item, { allRuns: loaded.runs, history, config, llm })),
  );

  if (values['update-history'] && values.history) {
    const failedTests = new Map(
      loaded.items.flatMap((item, i) =>
        item.run ? [[attemptKey(item.run), runs[i]?.tests ?? []] as const] : [],
      ),
    );
    history = recordRuns(history, loaded.runs, failedTests);
    writeFileSync(values.history, serializeHistory(history));
  }

  const quarantineText =
    values.quarantine && existsSync(values.quarantine)
      ? readFileSync(values.quarantine, 'utf8')
      : undefined;
  const path = patchTarget(values.quarantine, process.cwd());
  const proposal = proposeQuarantine({
    history,
    quarantine: loadQuarantine(quarantineText),
    quarantineText,
    path,
    config: config.flaky,
  });
  const report: TriageReport = {
    source: loaded.source,
    runs,
    skipped: loaded.skipped,
    proposal: proposal && { path, tests: proposal.tests },
  };

  const patchPath = values.out ? join(values.out, 'quarantine.patch') : 'quarantine.patch';
  const bodyPath = values.out ? join(values.out, 'quarantine-pr-body.md') : 'quarantine-pr-body.md';
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, 'triage.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(values.out, 'triage.md'), renderMarkdown(report, patchPath, bodyPath));
    if (proposal) {
      writeFileSync(patchPath, proposal.patch);
      writeFileSync(bodyPath, proposal.prBody);
    } else {
      rmSync(patchPath, { force: true });
      rmSync(bodyPath, { force: true });
    }
  }
  deps.out(renderText(report));
  if (proposal) {
    deps.out(
      `\nQuarantine proposal: ${proposal.tests.map((t) => t.id).join(', ')}\n${
        values.out ? '' : 'Run with --out DIR to write the patch and PR body.\n'
      }${maintainerCommands(patchPath, bodyPath, path)}`,
    );
  }
  return 0;
}

function metrics(argv: string[], deps: CliDeps): number {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      runs: { type: 'string' },
      since: { type: 'string' },
      until: { type: 'string' },
      'compare-at': { type: 'string' },
      label: { type: 'string', default: 'run records' },
      config: { type: 'string' },
    },
  });
  if (!values.runs) throw new UsageError('--runs FILE is required');
  const runs = parseRuns(read(values.runs, 'runs file'));
  const { min_samples } = loadConfigFile(values.config);
  const day = (iso: string): number => Math.floor(ms(iso) / DAY_MS) * DAY_MS;
  const since = values.since
    ? parseDay(values.since, '--since')
    : new Date(Math.min(...runs.map((r) => day(r.startedAt))));
  const until = values.until
    ? parseDay(values.until, '--until')
    : new Date(Math.max(...runs.map((r) => day(r.completedAt))) + DAY_MS);
  if (!values['compare-at']) {
    deps.out(
      `Data: ${values.label}\n\n${renderPeriod(computeMetrics(runs, { since, until }, min_samples), 'Period')}`,
    );
    return 0;
  }
  const split = parseDay(values['compare-at'], '--compare-at');
  deps.out(
    renderComparison(
      compareMetrics(runs, { since, until: split }, { since: split, until }, min_samples),
      values.label,
    ),
  );
  return 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (command === '--help' || command === '-h') {
    deps.out(USAGE);
    return 0;
  }
  try {
    if (command === 'triage') return await triage(rest, deps);
    if (command === 'metrics') return metrics(rest, deps);
    throw new UsageError(command ? `unknown command: ${command}` : 'no command given');
  } catch (e) {
    deps.err(`error: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof UsageError || e instanceof TypeError) deps.err(USAGE);
    return 2;
  }
}
