import type { Analysis, Triaged } from './analyze.js';
import { renderMetrics } from './metrics.js';
import type { Verdict } from './reachability.js';
import { TIERS } from './types.js';
import type { Tier } from './types.js';

const TIER_LABEL: Record<Tier, string> = {
  P0: 'fix now',
  P1: 'this sprint',
  P2: 'plan',
  P3: 'monitor',
};

const VERDICT_LABEL: Record<Verdict, string> = {
  'import-and-symbol-found': 'imported, advisory function name found',
  'import-found': 'imported',
  unknown: 'unknown (no import or function name found)',
};

const WIDTH = 76;

/** Wrap at WIDTH columns. `first` starts the first line, `rest` every later one. */
function wrap(text: string, first: string, rest = first): string[] {
  const lines: string[] = [];
  let line = first;
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > WIDTH && line.trim() !== '') {
      lines.push(line);
      line = rest;
    }
    line += (line === first || line === rest ? '' : ' ') + word;
  }
  if (line.trim() !== '') lines.push(line);
  return lines;
}

/** Pads to a column width, but always leaves one space so a long value cannot run into the next column. */
const pad = (s: string, n: number): string => (s.length >= n ? `${s} ` : s.padEnd(n));

function row(f: Triaged): string[] {
  const epss = f.epss === null ? 'EPSS n/a' : `EPSS ${f.epss.toFixed(2)}`;
  const first = `  ${pad(f.id, 21)}${pad(`${f.package} ${f.version}`, 20)}${pad(f.severity, 9)}${pad(epss, 10)}${f.inKev ? 'KEV ' : ''}${f.hasFix ? `fix ${f.fixVersions[0]}` : 'no fix'}`;
  const refs = f.reach.evidence.map((e) => e.ref).join(', ');
  const code = `      code: ${VERDICT_LABEL[f.reach.verdict]}${refs ? `: ${refs}` : ''}`;
  return [first.trimEnd(), code];
}

const FEEDS_LABEL: Record<string, string> = {
  live: 'live (CISA KEV, FIRST EPSS)',
  snapshot: 'committed snapshot (synthetic demo data)',
};
const feedsLine = (a: Analysis): string => `Feeds: ${FEEDS_LABEL[a.feedsSource] ?? a.feedsSource}`;

export function renderTable(a: Analysis): string {
  const lines = [
    `Prioritized findings: ${a.items.length} unresolved, waived: ${a.waived.length}`,
    feedsLine(a),
  ];
  for (const tier of TIERS) {
    const rows = a.items.filter((f) => f.tier === tier);
    if (rows.length === 0) continue;
    lines.push('', `${tier}  ${TIER_LABEL[tier]} (${rows.length})`, ...rows.flatMap(row));
  }
  if (a.missingEpss > 0)
    lines.push('', `EPSS missing for ${a.missingEpss} findings, treated as 0.`);
  for (const w of a.expiredWaivers) {
    lines.push(`Expired waiver ignored: ${w.id} ${w.package} (expired ${w.expires}).`);
  }
  return lines.join('\n');
}

const sourceLine = (label: string, source: string, reason: string | undefined, mode: string) =>
  `${label}: ${
    source === 'model'
      ? `${mode} model response`
      : source === 'deterministic'
        ? 'deterministic (no evidence to send to a model)'
        : `deterministic fallback (${reason ?? 'unknown reason'})`
  }`;

export function renderNotes(a: Analysis, mode: string): string {
  const lines = [sourceLine('Reachability notes', a.notes.source, a.notes.reason, mode)];
  for (const f of a.items.filter((x) => x.needsReview)) {
    lines.push('', `${f.id} ${f.package} (${f.app})`, ...wrap(f.note, '  '));
  }
  return lines.join('\n');
}

export function renderLeadership(a: Analysis, mode: string): string {
  const { note, source, reason } = a.leadership;
  return [
    sourceLine('Leadership note', source, reason, mode),
    '',
    note.headline,
    ...note.paragraphs.flatMap((p) => ['', ...wrap(p, '')]),
    '',
    'Assumptions:',
    ...note.assumptions.flatMap((s) => wrap(s, '  - ', '    ')),
  ].join('\n');
}

function gateLine(a: Analysis, failOn: string, epssThreshold: number): string {
  const rule = `fail on ${failOn} or higher that is in KEV or has EPSS above ${epssThreshold}`;
  return `GATE: ${a.gate.pass ? 'PASS' : 'FAIL'} (${rule})`;
}

export function renderGate(a: Analysis, failOn: string, epssThreshold: number): string {
  const lines = [feedsLine(a), gateLine(a, failOn, epssThreshold)];
  if (!a.gate.pass) {
    lines.push(
      `${a.gate.blocking.length} findings block the build:`,
      ...a.gate.blocking.map((b) => `  ${b.id} ${b.package} (${b.app}): ${b.why}`),
    );
  }
  return lines.join('\n');
}

export function renderMarkdown(
  a: Analysis,
  mode: string,
  failOn: string,
  epssThreshold: number,
): string {
  const table = [
    '| Tier | Id | Package | Severity | EPSS | KEV | Fix | Code search |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...a.items.map(
      (f) =>
        `| ${f.tier} | ${f.id} | ${f.package} ${f.version} (${f.app}) | ${f.severity} | ${f.epss === null ? 'n/a' : f.epss.toFixed(2)} | ${f.inKev ? 'yes' : 'no'} | ${f.hasFix ? f.fixVersions.join(', ') : 'none'} | ${f.reach.verdict} |`,
    ),
  ];
  return [
    `# Vulnerability triage, ${a.asOf}`,
    '',
    gateLine(a, failOn, epssThreshold),
    '',
    ...table,
    '',
    '## Reachability notes',
    '',
    sourceLine('Source', a.notes.source, a.notes.reason, mode),
    '',
    ...a.items.filter((f) => f.needsReview).flatMap((f) => [`- ${f.id} ${f.package}: ${f.note}`]),
    '',
    '## Leadership note',
    '',
    sourceLine('Source', a.leadership.source, a.leadership.reason, mode),
    '',
    `**${a.leadership.note.headline}**`,
    '',
    ...a.leadership.note.paragraphs.flatMap((p) => [p, '']),
    'Assumptions:',
    ...a.leadership.note.assumptions.map((s) => `- ${s}`),
    '',
    '## Metrics',
    '',
    '```text',
    renderMetrics(a.metrics),
    '```',
    '',
  ].join('\n');
}
