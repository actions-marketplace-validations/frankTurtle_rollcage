import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AnthropicLlm,
  AuditLogger,
  FakeLlm,
  type AuditRecord,
  readAuditRecords,
  resolveModel,
  sha256Hex,
  verifyAuditChain,
  type LlmClient,
} from '@adl/shared';
import { loadRoleAgents } from './agents.js';
import { ApprovalGate, DryRunCommitter } from './approval.js';
import { loadConfig } from './config.js';
import { computeMetrics } from './metrics.js';
import { LlmModelProvider } from './provider.js';
import { replayRecord } from './replay.js';
import { ROLES } from './roles.js';
import { parseRecord, runWorkflow, serializeRecord, type RunRecord } from './workflow.js';
import { markerTestRunner, Workspace } from './workspace.js';

export interface CliIo {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
}

const PIECE = join(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = `usage: workflow <command>
  run --task <text> (--replies <file> | --live) [--out dir] [--run-id id] [--branch name]
      [--repo files.json] [--config workflow.yml]
  approve <record> --by <name>
  commit <record>
  replay <record> [--repo files.json] [--config workflow.yml]
  metrics <dir>`;

const EXIT = { ok: 0, failed: 1, usage: 2, blocked: 3 } as const;

function parseArgs(args: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a.startsWith('--')) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) flags.set(a.slice(2), 'true');
      else {
        flags.set(a.slice(2), next);
        i++;
      }
    } else positional.push(a);
  }
  return { positional, flags };
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const auditPathFor = (recordPath: string): string => join(dirname(recordPath), 'audit.jsonl');
const short = (hash: string): string => hash.slice(0, 8);

function setup(flags: Map<string, string>) {
  const configPath = flags.get('config');
  const config = loadConfig(configPath ? readFileSync(configPath, 'utf8') : undefined);
  const agentsDir =
    flags.has('config') || flags.has('agents-dir')
      ? (flags.get('agents-dir') ?? config.agents_dir)
      : join(PIECE, config.agents_dir);
  const repo = readJson<Record<string, string>>(
    flags.get('repo') ?? join(PIECE, 'fixtures', 'repo.json'),
  );
  return { config, agents: loadRoleAgents(agentsDir), repo };
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  const { positional, flags } = parseArgs(rest);
  try {
    switch (command) {
      case 'run':
        return await cmdRun(flags, io);
      case 'approve':
        return cmdApprove(positional[0], flags, io);
      case 'commit':
        return await cmdCommit(positional[0], flags, io);
      case 'replay':
        return await cmdReplay(positional[0], flags, io);
      case 'metrics':
        return cmdMetrics(positional[0], io);
      default:
        io.err(USAGE);
        return EXIT.usage;
    }
  } catch (error) {
    io.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.usage;
  }
}

function llmFor(flags: Map<string, string>, io: CliIo): LlmClient {
  const replies = flags.get('replies');
  if (replies) return new FakeLlm(readJson<unknown[]>(replies).map((r) => JSON.stringify(r)));
  if (flags.has('live')) return new AnthropicLlm(io.env);
  throw new Error(
    'run needs --replies <file> (offline) or --live (calls Anthropic; needs ANTHROPIC_API_KEY)',
  );
}

async function cmdRun(flags: Map<string, string>, io: CliIo): Promise<number> {
  const task = flags.get('task');
  if (!task) throw new Error('run needs --task <text>');
  const { config, agents, repo } = setup(flags);
  const llm = llmFor(flags, io);
  const model = flags.has('live') ? resolveModel(io.env) : undefined;
  const out = flags.get('out') ?? 'workflow-out';
  mkdirSync(out, { recursive: true });
  const runId = flags.get('run-id') ?? `run-${short(sha256Hex(task))}`;
  const provider = new LlmModelProvider(llm, model ? { model } : {});

  const record = await runWorkflow({
    runId,
    task,
    agents,
    workspace: Workspace.fromFiles(repo),
    runTests: markerTestRunner,
    providerFor: () => provider,
    audit: new AuditLogger(join(out, 'audit.jsonl')),
    branch: flags.get('branch') ?? 'develop',
    maxReworkRounds: config.max_rework_rounds,
    maxSteps: config.max_steps,
  });
  const file = join(out, `run-${runId}.json`);
  writeFileSync(file, serializeRecord(record));

  for (const h of record.handoffs) {
    const tools = h.toolCalls.map((t) => t.name).join(',') || 'none';
    io.out(
      `${h.seq} ${h.agent.padEnd(11)} input=${short(h.inputHash)} tools=${tools} -> ${h.decision}`,
    );
  }
  io.out(`status: ${record.status}${record.reason ? ` (${record.reason})` : ''}`);
  if (record.status === 'awaiting-approval') {
    io.out('Nothing was committed. A human must approve this change before it can land:');
    io.out(`  workflow approve ${file} --by <name>`);
    return EXIT.ok;
  }
  return EXIT.failed;
}

function loadRecord(path: string | undefined): { record: RunRecord; path: string } {
  if (!path) throw new Error('a run record path is required');
  return { record: parseRecord(readFileSync(path, 'utf8')), path };
}

function gateFor(path: string, flags: Map<string, string>): ApprovalGate {
  const { config, agents } = setup(flags);
  return new ApprovalGate({
    auditPath: auditPathFor(path),
    agentBranches: config.agent_branches,
    agentNames: ROLES.map((r) => agents[r].name),
  });
}

function cmdApprove(recordPath: string | undefined, flags: Map<string, string>, io: CliIo): number {
  const { record, path } = loadRecord(recordPath);
  if (!record.change)
    throw new Error(`run ${record.runId} proposed no change (status ${record.status})`);
  gateFor(path, flags).approve(record.change, flags.get('by') ?? '');
  io.out(
    `approved change ${short(record.change.hash)} for ${record.change.branch} by ${flags.get('by')}`,
  );
  return EXIT.ok;
}

async function cmdCommit(
  recordPath: string | undefined,
  flags: Map<string, string>,
  io: CliIo,
): Promise<number> {
  const { record, path } = loadRecord(recordPath);
  if (!record.change)
    throw new Error(`run ${record.runId} proposed no change (status ${record.status})`);
  const result = await gateFor(path, flags).commit(record.change, new DryRunCommitter());
  if (!result.committed) {
    io.out(`BLOCKED: ${result.reason}`);
    return EXIT.blocked;
  }
  io.out(`committed ${result.commitId} to ${record.change.branch} (${result.reason})`);
  return EXIT.ok;
}

async function cmdReplay(
  recordPath: string | undefined,
  flags: Map<string, string>,
  io: CliIo,
): Promise<number> {
  const { record } = loadRecord(recordPath);
  const { agents, repo } = setup(flags);
  const report = await replayRecord(record, {
    agents,
    workspace: Workspace.fromFiles(repo),
    runTests: markerTestRunner,
  });
  io.out(
    `reducer replay of ${Object.keys(record.ledgers).length} ledgers: ${report.ledgersOk ? 'ok' : 'MISMATCH'}`,
  );
  io.out(
    `handoffs match their ledgers: ${report.handoffMismatches.length === 0 ? 'ok' : 'MISMATCH'}`,
  );
  for (const m of report.handoffMismatches) io.out(`  handoff ${m.seq}: ${m.what}`);
  io.out(
    `re-execution: ${report.reexecutionIdentical ? 'identical' : `MISMATCH${report.note ? ` (${report.note})` : ''}`}`,
  );
  return report.ok ? EXIT.ok : EXIT.failed;
}

function cmdMetrics(dir: string | undefined, io: CliIo): number {
  if (!dir) throw new Error('a directory of run records is required');
  const records = readdirSync(dir)
    .filter((f) => /^run-.*\.json$/.test(f))
    .sort()
    .map((f) => parseRecord(readFileSync(join(dir, f), 'utf8')));
  const auditPath = join(dir, 'audit.jsonl');
  let audit: AuditRecord[] = [];
  if (existsSync(auditPath)) {
    const chain = verifyAuditChain(auditPath);
    if (chain.ok) audit = readAuditRecords(auditPath);
    else
      io.out(
        `warning: ${basename(auditPath)} chain is broken at line ${chain.brokenAt}; its entries are not counted`,
      );
  }
  const m = computeMetrics(records, audit);
  io.out(`runs: ${m.runs}, with a proposed change: ${m.withChange}`);
  io.out(
    `changes with a complete trace: ${m.completeTrace}/${m.withChange} = ${m.completeTracePct}%`,
  );
  io.out(`rework after review: ${m.reworked}/${m.reviewed} = ${m.reworkRatePct}%`);
  return EXIT.ok;
}
