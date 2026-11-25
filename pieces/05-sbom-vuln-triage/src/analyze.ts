import type { LlmClient } from '@adl/shared';
import type { Feeds } from './feeds.js';
import { evaluateGate } from './gate.js';
import type { GateResult } from './gate.js';
import type { HistoryEntry } from './history.js';
import { computeMetrics } from './metrics.js';
import type { Metrics } from './metrics.js';
import { generateLeadershipNote, generateReachabilityNotes } from './notes.js';
import type { LeadershipFacts, LeadershipResult, NoteSource } from './notes.js';
import { prioritize } from './prioritize.js';
import type { PrioritizedFinding } from './prioritize.js';
import { findEvidence } from './reachability.js';
import type { Reachability, SourceIndex } from './reachability.js';
import type { SymbolHints } from './symbols.js';
import { TIERS } from './types.js';
import type { Finding, IsoDay, Tier } from './types.js';
import type { Waiver } from './waivers.js';

export interface AppInput {
  name: string;
  findings: Finding[];
  /** Package count from the SBOM, when one was given. */
  packages: number | null;
  source: SourceIndex;
}

export interface AnalyzeInput {
  apps: AppInput[];
  feeds: Feeds;
  symbols: SymbolHints;
  history: HistoryEntry[];
  waivers: Waiver[];
  asOf: IsoDay;
  epssThreshold: number;
  minutesPerFinding: number;
  failOn: string;
  llm: LlmClient;
}

export interface Triaged extends PrioritizedFinding {
  reach: Reachability;
  note: string;
}

export interface Analysis {
  asOf: IsoDay;
  feedsSource: string;
  apps: { name: string; packages: number | null; findings: number }[];
  items: Triaged[];
  waived: PrioritizedFinding[];
  expiredWaivers: Waiver[];
  missingEpss: number;
  metrics: Metrics;
  gate: GateResult;
  notes: { source: NoteSource; reason?: string };
  leadership: LeadershipResult;
}

/** The most urgent findings sent to the leadership note. */
const LEADERSHIP_TOP = 5;

export async function analyze(input: AnalyzeInput): Promise<Analysis> {
  const sources = new Map(input.apps.map((a) => [a.name, a.source]));
  const { items, waived, expiredWaivers } = prioritize(
    input.apps.flatMap((a) => a.findings),
    input.feeds,
    { epssThreshold: input.epssThreshold, asOf: input.asOf, waivers: input.waivers },
  );

  const withReach = items.map((f) => ({
    ...f,
    reach: findEvidence(f, sources.get(f.app) as SourceIndex, input.symbols),
  }));
  const metrics = computeMetrics(items, waived, input.history, {
    asOf: input.asOf,
    minutesPerFinding: input.minutesPerFinding,
  });
  const gate = evaluateGate(items, { failOn: input.failOn, epssThreshold: input.epssThreshold });
  // The two model calls do not depend on each other.
  const [noteResult, leadership] = await Promise.all([
    generateReachabilityNotes(input.llm, withReach),
    generateLeadershipNote(
      input.llm,
      leadershipFacts(input, withReach, waived.length, metrics, gate),
    ),
  ]);
  const triaged: Triaged[] = withReach.map((f) => ({
    ...f,
    note: noteResult.notes[f.key] as string,
  }));

  return {
    asOf: input.asOf,
    feedsSource: input.feeds.source,
    apps: input.apps.map((a) => ({
      name: a.name,
      packages: a.packages,
      findings: a.findings.length,
    })),
    items: triaged,
    waived,
    expiredWaivers,
    missingEpss: items.filter((f) => f.epss === null).length,
    metrics,
    gate,
    notes: {
      source: noteResult.source,
      ...(noteResult.reason ? { reason: noteResult.reason } : {}),
    },
    leadership,
  };
}

function leadershipFacts(
  input: AnalyzeInput,
  items: (PrioritizedFinding & { reach: Reachability })[],
  waived: number,
  metrics: Metrics,
  gate: GateResult,
): LeadershipFacts {
  const tiers = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  for (const f of items) tiers[f.tier] += 1;
  return {
    asOf: input.asOf,
    apps: input.apps.map((a) => a.name),
    unresolved: items.length,
    waived,
    tiers,
    openCriticals: metrics.openCriticals,
    blocking: gate.blocking.length,
    failOn: input.failOn,
    mttrDays:
      metrics.mttr.overallDays === null ? null : Math.round(metrics.mttr.overallDays * 10) / 10,
    top: items.slice(0, LEADERSHIP_TOP).map((f) => ({
      id: f.id,
      package: f.package,
      app: f.app,
      tier: f.tier,
      why: f.reasons.filter((r) => r !== 'fix available').join(', '),
      action: f.action,
      reach: f.reach.verdict,
    })),
  };
}
