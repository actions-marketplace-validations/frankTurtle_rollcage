import type { Feeds } from './feeds.js';
import { findingKey } from './types.js';
import type { Finding, IsoDay, Severity, Tier } from './types.js';
import type { Waiver } from './waivers.js';

export const DEFAULT_EPSS_THRESHOLD = 0.1;

const RANK: Record<Severity, number> = {
  Critical: 5,
  High: 4,
  Medium: 3,
  Low: 2,
  Negligible: 1,
  Unknown: 0,
};

export const severityRank = (s: Severity): number => RANK[s];

/** True when `severity` is at or above `threshold` (given in any letter case). */
export function meetsSeverity(severity: Severity, threshold: string): boolean {
  const wanted = Object.entries(RANK).find(
    ([name]) => name.toLowerCase() === threshold.toLowerCase(),
  );
  return severityRank(severity) >= (wanted?.[1] ?? Infinity);
}

export interface PrioritizedFinding extends Finding {
  key: string;
  tier: Tier;
  inKev: boolean;
  /** EPSS score, or null when the feed has no entry for the CVE. */
  epss: number | null;
  hasFix: boolean;
  action: string;
  reasons: string[];
  needsReview: boolean;
}

export interface PrioritizeOptions {
  epssThreshold: number;
  asOf: IsoDay;
  waivers?: Waiver[];
}

export interface Prioritized {
  /** Unresolved findings in work order. */
  items: PrioritizedFinding[];
  /** Findings covered by an unexpired waiver. */
  waived: PrioritizedFinding[];
  expiredWaivers: Waiver[];
}

function tierOf(severity: Severity, inKev: boolean, epssHigh: boolean): Tier {
  if (inKev || (severity === 'Critical' && epssHigh)) return 'P0';
  if (severity === 'Critical' || (severity === 'High' && epssHigh)) return 'P1';
  if (severity === 'High' || (severity === 'Medium' && epssHigh)) return 'P2';
  return 'P3';
}

function score(f: Finding, feeds: Feeds, epssThreshold: number): PrioritizedFinding {
  const inKev = f.cve !== null && feeds.kev.has(f.cve);
  const epss = f.cve === null ? null : (feeds.epss.get(f.cve) ?? null);
  const epssHigh = (epss ?? 0) > epssThreshold;
  const hasFix = f.fixVersions.length > 0;
  const tier = tierOf(f.severity, inKev, epssHigh);
  const reasons = [`severity ${f.severity}`];
  if (inKev) reasons.push('in KEV');
  reasons.push(epss === null ? 'EPSS missing' : `EPSS ${epss.toFixed(2)}`);
  reasons.push(hasFix ? 'fix available' : 'no fix released');
  const action = hasFix
    ? `upgrade ${f.package} to ${f.fixVersions.join(' or ')}`
    : 'no fix released: mitigate or accept with a waiver';
  return {
    ...f,
    key: findingKey(f),
    tier,
    inKev,
    epss,
    hasFix,
    action,
    reasons,
    needsReview: tier === 'P0' || tier === 'P1' || (tier === 'P2' && !hasFix),
  };
}

const compare = (a: PrioritizedFinding, b: PrioritizedFinding): number =>
  a.tier.localeCompare(b.tier) ||
  (b.epss ?? 0) - (a.epss ?? 0) ||
  severityRank(b.severity) - severityRank(a.severity) ||
  Number(b.hasFix) - Number(a.hasFix) ||
  a.id.localeCompare(b.id) ||
  a.package.localeCompare(b.package);

export function prioritize(
  findings: Finding[],
  feeds: Feeds,
  opts: PrioritizeOptions,
): Prioritized {
  const waivers = opts.waivers ?? [];
  const live = waivers.filter((w) => w.expires > opts.asOf);
  const expiredWaivers = waivers.filter((w) => w.expires <= opts.asOf);
  const items: PrioritizedFinding[] = [];
  const waived: PrioritizedFinding[] = [];
  for (const f of findings) {
    const scored = score(f, feeds, opts.epssThreshold);
    const covered = live.some((w) => w.id === f.id && w.package === f.package);
    (covered ? waived : items).push(scored);
  }
  items.sort(compare);
  waived.sort(compare);
  return { items, waived, expiredWaivers };
}
