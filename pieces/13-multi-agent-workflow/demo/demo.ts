/**
 * Demo driver. The model replies are recorded fixtures, the repository and tests are made up, and
 * nothing here calls a network. Stages: before, run, after, metric.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AuditLogger,
  FakeLlm,
  bold,
  green,
  header,
  readAuditRecords,
  red,
  runStages,
} from '@adl/shared';
import { loadRoleAgents } from '../src/agents.js';
import { ApprovalGate, DryRunCommitter } from '../src/approval.js';
import { computeMetrics } from '../src/metrics.js';
import { LlmModelProvider } from '../src/provider.js';
import { replayRecord } from '../src/replay.js';
import { ROLES } from '../src/roles.js';
import { parseRecord, runWorkflow, serializeRecord, type RunRecord } from '../src/workflow.js';
import { markerTestRunner, Workspace } from '../src/workspace.js';

const piece = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(piece, 'demo', 'out');
const auditPath = join(out, 'audit.jsonl');
const TASK = 'Make greet() fall back to "world" when the name is empty';
const agents = loadRoleAgents(join(piece, 'agents'));
const readJson = <T>(rel: string): T => JSON.parse(readFileSync(join(piece, rel), 'utf8')) as T;
const repo = () => Workspace.fromFiles(readJson('fixtures/repo.json'));
const now = () => new Date('2026-01-01T09:00:00.000Z');
const recordPath = (id: string) => join(out, `run-${id}.json`);
const short = (h: string) => h.slice(0, 8);

async function record(id: string, fixture: string): Promise<RunRecord> {
  const llm = new FakeLlm(readJson<unknown[]>(fixture).map((r) => JSON.stringify(r)));
  const provider = new LlmModelProvider(llm);
  const result = await runWorkflow({
    runId: id,
    task: TASK,
    agents,
    workspace: repo(),
    runTests: markerTestRunner,
    providerFor: () => provider,
    audit: new AuditLogger(auditPath, now),
    branch: 'develop',
    commitMessage: 'feat: greet falls back to world',
  });
  writeFileSync(recordPath(id), serializeRecord(result));
  return result;
}

/** Fresh output folder, then both recorded runs. */
async function recordAll(): Promise<RunRecord[]> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  return [
    await record('demo-clean', 'fixtures/replies-clean.json'),
    await record('demo-rework', 'fixtures/replies-rework.json'),
  ];
}

const load = (id: string): RunRecord => parseRecord(readFileSync(recordPath(id), 'utf8'));

const gate = () =>
  new ApprovalGate({
    auditPath,
    agentBranches: ['agent/*'],
    agentNames: [...ROLES],
    now,
  });

function before(): void {
  header('BEFORE: what an unattended agent leaves behind');
  console.log('git log -1 on develop:');
  console.log('  feat: greet falls back to world');
  console.log('');
  console.log('Which agent decided what?   not recorded');
  console.log('What input did it get?      not recorded');
  console.log('Which tools did it call?    not recorded');
  console.log('Who agreed to the merge?    nobody asked');
}

async function run(): Promise<void> {
  header('RUN: planner to reviewer (recorded model replies)');
  const [clean] = await recordAll();
  const r = clean as RunRecord;
  for (const h of r.handoffs) {
    const tools = h.toolCalls.map((t) => t.name).join(', ') || 'none';
    console.log(`${h.seq}. ${h.agent}`);
    console.log(`   input   ${short(h.inputHash)}`);
    console.log(`   tools   ${tools}`);
    console.log(`   result  ${h.decision}`);
  }
  console.log('');
  console.log(bold(`status: ${r.status}`));
  console.log(`Nothing was committed. Change ${short(r.change?.hash ?? '')} waits for a human.`);
  console.log('A second run (reviewer asked for a change) is recorded for the metric stage.');
}

async function after(): Promise<void> {
  await recordAll();
  const r = load('demo-clean');
  const change = r.change;
  if (!change) throw new Error('demo run proposed no change');
  const committer = new DryRunCommitter();
  const g = gate();

  header('AFTER 1: commit to develop with no approval');
  const blocked = await g.commit(change, committer);
  console.log(red(`BLOCKED: ${blocked.reason}`));
  console.log(`committer calls: ${committer.commits.length}`);

  header('AFTER 2: an agent tries to approve its own change');
  try {
    g.approve(change, 'agent:reviewer');
  } catch (error) {
    console.log(red(`REJECTED: ${(error as Error).message}`));
  }

  header('AFTER 3: a human approves that exact change');
  g.approve(change, 'alice');
  const done = await g.commit(change, committer);
  console.log(green(`committed ${done.commitId} to ${change.branch} (${done.reason})`));

  header('AFTER 4: replay the recorded run');
  const deps = { agents, workspace: repo(), runTests: markerTestRunner };
  const ok = await replayRecord(r, deps);
  console.log(
    `reducer replay of ${Object.keys(r.ledgers).length} ledgers: ${ok.ledgersOk ? 'ok' : 'MISMATCH'}`,
  );
  console.log(
    `handoffs match ledgers:      ${ok.handoffMismatches.length === 0 ? 'ok' : 'MISMATCH'}`,
  );
  console.log(`re-execution:                ${ok.reexecutionIdentical ? 'identical' : 'MISMATCH'}`);

  header('AFTER 5: edit one recorded tool result, replay again');
  const edited = parseRecord(serializeRecord(r));
  const tester = edited.ledgers[edited.handoffs[2]?.ledgerKey ?? ''];
  const event = tester?.entries.find((e) => e.event.type === 'tools.completed')?.event;
  if (event?.type === 'tools.completed') {
    (event.results[0] as { content: string }).content = '{"passed":true,"summary":"edited"}';
  }
  const bad = await replayRecord(edited, { ...deps, workspace: repo() });
  console.log(`replay ok: ${bad.ok ? 'yes' : red('NO')}`);
  for (const m of bad.handoffMismatches) console.log(red(`  handoff ${m.seq}: ${m.what}`));
}

async function metric(): Promise<void> {
  const files = readdirSync(out).filter((f) => /^run-.*\.json$/.test(f));
  const records =
    files.length > 0 ? files.sort().map((f) => load(f.slice(4, -5))) : await recordAll();
  const m = computeMetrics(records, readAuditRecords(auditPath));
  header('METRIC (two recorded fixture runs, not real data)');
  console.log(
    `changes with a complete trace: ${m.completeTrace}/${m.withChange} = ${m.completeTracePct}%`,
  );
  console.log(`rework after review:           ${m.reworked}/${m.reviewed} = ${m.reworkRatePct}%`);
}

process.exitCode = await runStages({ before, run, after, metric }, process.argv[2] ?? 'all');
