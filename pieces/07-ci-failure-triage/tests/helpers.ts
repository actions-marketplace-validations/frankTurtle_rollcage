import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRuns } from '../src/runs.ts';
import type { RunRecord } from '../src/runs.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, '..', 'fixtures');
export const LLM_FIXTURES = join(here, '..', 'demo', 'llm-fixtures');

export const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
export const readLog = (name: string): string => fixtureText(`logs/${name}`);
export const fixtureRuns = (): RunRecord[] => parseRuns(fixtureText('runs.json'));
export const tmp = (): string => mkdtempSync(join(tmpdir(), 'triage-test-'));

/** A GitHub-style log line prefix, so inline snippets look like real job logs. */
export const gh = (...lines: string[]): string =>
  lines.map((l, i) => `2026-03-17T09:14:0${i}.1034521Z ${l}`).join('\n');
