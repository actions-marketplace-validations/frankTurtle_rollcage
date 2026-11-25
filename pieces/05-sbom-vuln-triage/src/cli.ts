import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AnthropicLlm, RecordReplayLlm, isLiveMode } from '@adl/shared';
import type { FetchLike, LlmClient } from '@adl/shared';
import { analyze } from './analyze.js';
import type { AppInput, Analysis } from './analyze.js';
import { fetchEpss, fetchKev, loadSnapshotFeeds } from './feeds.js';
import type { Feeds } from './feeds.js';
import { writeGateAudit } from './gate.js';
import { parseGrype } from './grype.js';
import { parseHistory } from './history.js';
import { runSyftAndGrype, spawnRunner } from './live.js';
import type { Runner } from './live.js';
import { renderMetrics } from './metrics.js';
import { DEFAULT_EPSS_THRESHOLD } from './prioritize.js';
import { buildSourceIndex } from './reachability.js';
import { diffSboms, parseSbom, renderDiff } from './sbom.js';
import {
  renderGate,
  renderLeadership,
  renderMarkdown,
  renderNotes,
  renderTable,
} from './render.js';
import { parseSymbols } from './symbols.js';
import type { Finding } from './types.js';
import { parseWaivers } from './waivers.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  now?: () => Date;
  /** Runs syft and grype in --live mode. Defaults to spawning the real programs. */
  runner?: Runner;
  /** Used by --live-feeds. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
  /** Replaces the default model client (recorded responses, or live with --llm-live). */
  llm?: LlmClient;
}

const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url));
const DEFAULT_MINUTES_PER_FINDING = 15;
const FAIL_ON = ['critical', 'high', 'medium', 'low'];
const SECTIONS = ['table', 'notes', 'leadership', 'metrics', 'gate'];

const USAGE = `Usage:
  sbom-triage report  --app NAME:GRYPE_JSON:SRC_DIR [--app ...] [options]
  sbom-triage gate    --app ... [--fail-on critical] [options]   exit 1 when the gate fails
  sbom-triage metrics --app ... [options]
  sbom-triage diff    --from OLD_SBOM --to NEW_SBOM
  sbom-triage report  --live --path DIR [options]               runs syft and grype on DIR
Options: --sbom FILE (repeatable) --kev FILE --epss FILE --symbols FILE --history FILE
  --waivers FILE --as-of YYYY-MM-DD --epss-threshold N --minutes-per-finding N --out DIR
  --show table,notes,leadership,metrics,gate --audit FILE --live-feeds --llm-live`;

const OPTIONS = {
  app: { type: 'string', multiple: true },
  sbom: { type: 'string', multiple: true },
  kev: { type: 'string' },
  epss: { type: 'string' },
  symbols: { type: 'string' },
  history: { type: 'string' },
  waivers: { type: 'string' },
  'as-of': { type: 'string' },
  'epss-threshold': { type: 'string' },
  'minutes-per-finding': { type: 'string' },
  'fail-on': { type: 'string' },
  show: { type: 'string' },
  out: { type: 'string' },
  audit: { type: 'string' },
  path: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  live: { type: 'boolean' },
  'live-feeds': { type: 'boolean' },
  'llm-live': { type: 'boolean' },
} as const;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS }>>['values'];

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

function number(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} must be a non-negative number`);
  return n;
}

async function loadApps(
  v: Values,
  deps: CliDeps,
): Promise<{ apps: AppInput[]; findings: Finding[] }> {
  const sboms = v.sbom ?? [];
  const packages = (i: number): number | null => {
    const file = sboms[i];
    return file ? parseSbom(readJson(file)).length : null;
  };
  const apps: AppInput[] = [];
  if (v.live) {
    if (!v.path) throw new Error('--live needs --path DIR');
    const dir = resolve(v.path);
    const name = basename(dir);
    const { sbom, grype } = await runSyftAndGrype(dir, deps.runner ?? spawnRunner);
    apps.push({
      name,
      findings: parseGrype(JSON.parse(grype), name),
      packages: parseSbom(JSON.parse(sbom)).length,
      source: buildSourceIndex(dir),
    });
  } else {
    const specs = v.app ?? [];
    if (specs.length === 0)
      throw new Error('give at least one --app NAME:GRYPE_JSON:SRC_DIR, or --live --path DIR');
    specs.forEach((spec, i) => {
      const [name, grypeFile, srcDir, ...extra] = spec.split(':');
      if (!name || !grypeFile || !srcDir || extra.length > 0) {
        throw new Error(`bad --app "${spec}": expected NAME:GRYPE_JSON:SRC_DIR`);
      }
      apps.push({
        name,
        findings: parseGrype(readJson(grypeFile), name),
        packages: packages(i),
        source: buildSourceIndex(srcDir),
      });
    });
  }
  return { apps, findings: apps.flatMap((a) => a.findings) };
}

async function loadFeeds(v: Values, findings: Finding[], deps: CliDeps): Promise<Feeds> {
  if (v['live-feeds']) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const cves = [...new Set(findings.flatMap((f) => (f.cve ? [f.cve] : [])))].sort();
    const [kev, epss] = await Promise.all([fetchKev(fetchImpl), fetchEpss(fetchImpl, cves)]);
    return { kev, epss, source: 'live' };
  }
  return loadSnapshotFeeds(
    v.kev ?? join(FIXTURES, 'kev-snapshot.json'),
    v.epss ?? join(FIXTURES, 'epss-snapshot.json'),
  );
}

function chooseLlm(v: Values, deps: CliDeps): { llm: LlmClient; mode: string } {
  if (deps.llm) return { llm: deps.llm, mode: 'injected' };
  if (v['llm-live'] || isLiveMode(deps.env)) {
    return { llm: new AnthropicLlm(deps.env), mode: 'live' };
  }
  return { llm: new RecordReplayLlm(join(FIXTURES, 'llm'), 'replay'), mode: 'recorded' };
}

function writeOutputs(dir: string, a: Analysis, mode: string, failOn: string, epss: number): void {
  mkdirSync(dir, { recursive: true });
  const json = {
    asOf: a.asOf,
    feeds: a.feedsSource,
    apps: a.apps,
    items: a.items,
    waived: a.waived,
    metrics: a.metrics,
    gate: { pass: a.gate.pass, blocking: a.gate.blocking.map((b) => b.key) },
    notes: a.notes,
    leadership: a.leadership,
  };
  writeFileSync(join(dir, 'findings.json'), `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), renderMarkdown(a, mode, failOn, epss));
  writeFileSync(join(dir, 'leadership.md'), `${renderLeadership(a, mode)}\n`);
}

async function triage(command: string, v: Values, deps: CliDeps): Promise<number> {
  const failOn = (v['fail-on'] ?? 'critical').toLowerCase();
  if (!FAIL_ON.includes(failOn)) throw new Error(`--fail-on must be one of ${FAIL_ON.join(', ')}`);
  const defaults: Record<string, string> = {
    report: 'table,notes,leadership,metrics',
    gate: 'gate',
    metrics: 'metrics',
  };
  const show = (v.show ?? defaults[command] ?? '').split(',');
  const unknown = show.find((s) => !SECTIONS.includes(s));
  if (unknown) throw new Error(`--show: unknown section "${unknown}"`);

  const epssThreshold = number(v['epss-threshold'], DEFAULT_EPSS_THRESHOLD, '--epss-threshold');
  const { apps, findings } = await loadApps(v, deps);
  const { llm, mode } = chooseLlm(v, deps);
  const analysis = await analyze({
    apps,
    feeds: await loadFeeds(v, findings, deps),
    symbols: parseSymbols(readJson(v.symbols ?? join(FIXTURES, 'symbols.json'))),
    history: v.history ? parseHistory(readJson(v.history)) : [],
    waivers: v.waivers ? parseWaivers(readJson(v.waivers)) : [],
    asOf: v['as-of'] ?? (deps.now?.() ?? new Date()).toISOString().slice(0, 10),
    epssThreshold,
    minutesPerFinding: number(
      v['minutes-per-finding'],
      DEFAULT_MINUTES_PER_FINDING,
      '--minutes-per-finding',
    ),
    failOn,
    llm,
  });

  const sections: Record<string, () => string> = {
    table: () => renderTable(analysis),
    notes: () => renderNotes(analysis, mode),
    leadership: () => renderLeadership(analysis, mode),
    metrics: () => renderMetrics(analysis.metrics),
    gate: () => renderGate(analysis, failOn, epssThreshold),
  };
  deps.out(show.map((s) => (sections[s] as () => string)()).join('\n\n'));
  if (v.out) writeOutputs(v.out, analysis, mode, failOn, epssThreshold);
  if (command !== 'gate') return 0;
  if (v.audit) writeGateAudit(v.audit, analysis.gate, { failOn, epssThreshold }, deps.now);
  return analysis.gate.pass ? 0 : 1;
}

function diff(v: Values, deps: CliDeps): number {
  if (!v.from || !v.to) throw new Error('diff needs --from OLD_SBOM and --to NEW_SBOM');
  const result = diffSboms(parseSbom(readJson(v.from)), parseSbom(readJson(v.to)));
  deps.out(renderDiff(result, basename(v.from), basename(v.to)));
  return 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || !['report', 'gate', 'metrics', 'diff'].includes(command)) {
    deps.err(USAGE);
    return 2;
  }
  try {
    const { values } = parseArgs({ args: rest, options: OPTIONS });
    return command === 'diff' ? diff(values, deps) : await triage(command, values, deps);
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
