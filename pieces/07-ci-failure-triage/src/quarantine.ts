import { z } from 'zod';
import type { FlakyConfig } from './config.js';
import { flipStats, isFlaky } from './history.js';
import type { FlipStats, History } from './history.js';

const EntrySchema = z.object({
  id: z.string().min(1),
  reason: z.string(),
  /** Left blank by the proposal on purpose: a person decides who owns the fix. */
  owner: z.string(),
});
const QuarantineSchema = z.object({ version: z.literal(1), tests: z.array(EntrySchema) });
export type Quarantine = z.infer<typeof QuarantineSchema>;

export function loadQuarantine(text?: string): Quarantine {
  if (!text?.trim()) return { version: 1, tests: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('quarantine file is not valid JSON');
  }
  const parsed = QuarantineSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(
      `quarantine file is invalid: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`,
    );
  }
  return parsed.data;
}

export interface ProposedTest extends FlipStats {
  id: string;
}

export interface QuarantineProposal {
  tests: ProposedTest[];
  newText: string;
  patch: string;
  prBody: string;
}

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

export function proposeQuarantine(input: {
  history: History;
  quarantine: Quarantine;
  /** Current file text, or undefined when the file does not exist yet. */
  quarantineText: string | undefined;
  path: string;
  config: FlakyConfig;
}): QuarantineProposal | null {
  const listed = new Set(input.quarantine.tests.map((t) => t.id));
  const tests = Object.keys(input.history.tests)
    .filter((id) => !listed.has(id))
    .map((id): ProposedTest => ({ id, ...flipStats(input.history, id) }))
    .filter((t) => isFlaky(t, input.config))
    .sort((a, b) => b.flipRate - a.flipRate || a.id.localeCompare(b.id));
  if (tests.length === 0) return null;

  const next: Quarantine = {
    version: 1,
    tests: [
      ...input.quarantine.tests,
      ...tests.map((t) => ({
        id: t.id,
        reason: `Failed and passed on the same commit in ${t.flipCommits} of ${t.observedCommits} observed commits (${pct(t.flipRate)}).`,
        owner: '',
      })),
    ],
  };
  const newText = `${JSON.stringify(next, null, 2)}\n`;
  return {
    tests,
    newText,
    patch: unifiedDiff(input.path, input.quarantineText, newText),
    prBody: prBody(tests, input.config, input.path),
  };
}

function prBody(tests: ProposedTest[], cfg: FlakyConfig, path: string): string {
  const rows = tests
    .map((t) => `| \`${t.id}\` | ${t.flipCommits} of ${t.observedCommits} | ${pct(t.flipRate)} |`)
    .join('\n');
  return [
    '# Quarantine flaky tests (proposal)',
    '',
    `This change adds ${tests.length} test${tests.length === 1 ? '' : 's'} to \`${path}\`. It was drafted by CI failure triage and needs human review before it is merged.`,
    '',
    '| Test | Commits where it failed and passed | Flip rate |',
    '| --- | --- | --- |',
    rows,
    '',
    `Thresholds used: at least ${cfg.min_observations} observed commits, at least ${cfg.min_flip_commits} flip commits, flip rate at least ${pct(cfg.flip_rate_threshold)}. These are this tool's own defaults, not industry figures.`,
    '',
    '## Assumptions',
    '',
    '- A flip means the test failed and passed on the same commit. This is evidence of flakiness, not proof of the cause.',
    '- The history only covers runs this tool has seen. Tests that were fixed since may still appear.',
    '- Quarantined tests still need an owner and a fix. The owner field is blank on purpose.',
    '',
    '## Reviewer checklist',
    '',
    '- [ ] Each test really is flaky (read a failing log and a passing log).',
    '- [ ] An owner is named for each test.',
    '- [ ] The test runner is set up to read this list and not block on these tests.',
    '',
  ].join('\n');
}

/** The commands a maintainer runs to turn the proposal into a pull request. This piece only prints them. */
export function maintainerCommands(
  patchPath: string,
  bodyPath: string,
  targetFile: string,
): string {
  return [
    'To turn this proposal into a pull request, a maintainer runs:',
    '  git switch -c chore/quarantine-flaky-tests',
    `  git apply ${patchPath}`,
    `  git add ${targetFile}`,
    '  git commit -m "chore(ci): quarantine flaky tests"',
    `  gh pr create --title "Quarantine flaky tests" --body-file ${bodyPath}`,
    'Nothing was applied or opened by this tool.',
  ].join('\n');
}

/**
 * Unified diff of one file as one hunk with three lines of context, in the form `git apply`
 * accepts. `oldText` undefined means the file does not exist, so the diff creates it.
 */
export function unifiedDiff(path: string, oldText: string | undefined, newText: string): string {
  const oldLines = oldText === undefined ? [] : splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start++;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }
  if (endOld === start && endNew === start && oldText !== undefined) return '';

  const ctx = 3;
  const from = Math.max(0, start - ctx);
  const tailOld = Math.min(oldLines.length, endOld + ctx);
  const before = oldLines.slice(from, start).map((l) => ` ${l}`);
  const removed = oldLines.slice(start, endOld).map((l) => `-${l}`);
  const added = newLines.slice(start, endNew).map((l) => `+${l}`);
  const after = oldLines.slice(endOld, tailOld).map((l) => ` ${l}`);
  const oldCount = tailOld - from;
  const newCount = oldCount - (endOld - start) + (endNew - start);
  const range = (first: number, count: number): string =>
    `${count === 0 ? first : first + 1},${count}`;
  const header =
    oldText === undefined
      ? [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`]
      : [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
  return `${[
    ...header,
    `@@ -${range(from, oldCount)} +${range(from, newCount)} @@`,
    ...before,
    ...removed,
    ...added,
    ...after,
  ].join('\n')}\n`;
}

const splitLines = (text: string): string[] =>
  text === '' ? [] : text.replace(/\n$/, '').split('\n');
