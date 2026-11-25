import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuditLogger, FakeLlm } from '@adl/shared';
import { loadRoleAgents } from '../src/agents.js';
import { llmModelProvider } from '../src/provider.js';
import { runWorkflow, type RunRecord, type WorkflowOptions } from '../src/workflow.js';
import { markerTestRunner, Workspace } from '../src/workspace.js';

export const PIECE = join(dirname(fileURLToPath(import.meta.url)), '..');
export const AGENTS_DIR = join(PIECE, 'agents');
export const FIXED_NOW = () => new Date('2026-01-01T00:00:00.000Z');

export const tmp = (): string => mkdtempSync(join(tmpdir(), 'maw-'));

export const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(PIECE, rel), 'utf8')) as T;

export interface Reply {
  say: string;
  tool_calls?: { name: string; args: Record<string, unknown> }[];
}

export const replies = (name: 'clean' | 'rework'): string[] =>
  readJson<Reply[]>(`fixtures/replies-${name}.json`).map((r) => JSON.stringify(r));

export const freshWorkspace = (): Workspace =>
  Workspace.fromFiles(readJson<Record<string, string>>('fixtures/repo.json'));

export interface World {
  dir: string;
  auditPath: string;
  options: WorkflowOptions;
  llm: FakeLlm;
}

export function world(
  raw: string[],
  overrides: Partial<WorkflowOptions> = {},
  runId = 'run-test',
): World {
  const dir = tmp();
  const auditPath = join(dir, 'audit.jsonl');
  const llm = new FakeLlm(raw);
  const provider = llmModelProvider(llm);
  const options: WorkflowOptions = {
    runId,
    task: 'Make greet() fall back to "world" when the name is empty',
    agents: loadRoleAgents(AGENTS_DIR),
    workspace: freshWorkspace(),
    runTests: markerTestRunner,
    providerFor: () => provider,
    audit: new AuditLogger(auditPath, FIXED_NOW),
    branch: 'develop',
    commitMessage: 'feat: greet falls back to world',
    ...overrides,
  };
  return { dir, auditPath, options, llm };
}

export async function cleanRun(): Promise<{ w: World; record: RunRecord }> {
  const w = world(replies('clean'));
  return { w, record: await runWorkflow(w.options) };
}
