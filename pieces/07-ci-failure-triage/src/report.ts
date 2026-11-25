import { maintainerCommands } from './quarantine.js';
import type { ProposedTest } from './quarantine.js';
import type { TriagedRun } from './triage.js';

export interface TriageReport {
  source: 'runs' | 'github' | 'logs';
  runs: TriagedRun[];
  skipped: { id: string; reason: string }[];
  proposal: { path: string; tests: ProposedTest[] } | null;
}

const WIDTH = 76;

function wrap(text: string, indent: string): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && indent.length + current.length + 1 + word.length > WIDTH) {
      lines.push(indent + current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(indent + current);
  return lines;
}

const field = (label: string, text: string): string[] => {
  const [first = '', ...rest] = wrap(text, '');
  return [`  ${label.padEnd(11)}${first}`, ...rest.map((l) => `  ${' '.repeat(11)}${l}`)];
};

const heading = (r: TriagedRun): string =>
  r.workflow ? `Run ${r.id}  ${r.workflow}  ${r.branch ?? ''}`.trimEnd() : `Log ${r.id}`;

/** Plain text for the terminal: short lines, one block per run. */
export function renderText(report: TriageReport): string {
  const blocks = report.runs.map((r) =>
    [
      heading(r),
      ...field('Category', `${r.category} (confidence: ${r.confidence}, rule: ${r.ruleId})`),
      ...field('Signature', r.signature.hash ? `${r.signature.hash}  ${r.signature.text}` : 'none'),
      ...r.evidence.flatMap((e, i) => field(i === 0 ? 'Evidence' : '', `- ${e}`)),
      ...field('Summary', r.summary),
      ...field('Next step', r.nextStep),
      ...r.assumptions.flatMap((a, i) => field(i === 0 ? 'Assumes' : '', `- ${a}`)),
      ...field(
        'Written by',
        r.summarySource === 'model'
          ? 'model'
          : `fixed text (model not used: ${r.summaryReason ?? 'unknown'})`,
      ),
    ].join('\n'),
  );
  const skipped = report.skipped.length
    ? [
        `Skipped ${report.skipped.length} failed runs: ${[...new Set(report.skipped.map((s) => s.reason))].join('; ')}`,
      ]
    : [];
  const counts = countByCategory(report.runs);
  return [
    `Triaged ${report.runs.length} failed runs. ${counts}`,
    '',
    ...blocks.flatMap((b) => [b, '']),
    ...skipped,
  ]
    .join('\n')
    .trimEnd();
}

function countByCategory(runs: TriagedRun[]): string {
  const counts = new Map<string, number>();
  for (const r of runs) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  return [...counts].map(([c, n]) => `${n} ${c}`).join(', ');
}

/** The markdown report, written to triage.md and suitable for a step summary. */
export function renderMarkdown(report: TriageReport, patchPath: string, bodyPath: string): string {
  const rows = report.runs
    .map(
      (r) =>
        `| ${r.id} | ${r.category} | ${r.confidence} | \`${r.signature.hash || '-'}\` | ${r.tests.length} |`,
    )
    .join('\n');
  const detail = report.runs.flatMap((r) => [
    `### ${heading(r)}`,
    '',
    `- Category: ${r.category}, confidence ${r.confidence}, rule \`${r.ruleId}\`.`,
    `- Signature: \`${r.signature.text || 'none'}\``,
    ...r.evidence.map((e) => `- Evidence: ${e}`),
    `- Summary: ${r.summary}`,
    `- Next step: ${r.nextStep}`,
    ...r.assumptions.map((a) => `- Assumption: ${a}`),
    `- Summary written by: ${r.summarySource === 'model' ? 'model' : `fixed text (${r.summaryReason ?? 'model not used'})`}`,
    '',
  ]);
  const quarantine = report.proposal
    ? [
        '## Quarantine proposal',
        '',
        ...report.proposal.tests.map(
          (t) =>
            `- \`${t.id}\`: failed and passed on the same commit in ${t.flipCommits} of ${t.observedCommits} observed commits.`,
        ),
        '',
        'A person must review this before it is merged. Nothing was applied or opened.',
        '',
        '```bash',
        maintainerCommands(patchPath, bodyPath, report.proposal.path),
        '```',
        '',
      ]
    : [];
  return [
    '# CI failure triage',
    '',
    'Categories are a heuristic reading of the logs and run history, not confirmed root causes.',
    '',
    '| Run | Category | Confidence | Signature | Failing tests |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
    ...detail,
    ...quarantine,
  ].join('\n');
}
