import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AnthropicLlm, RecordReplayLlm, isLiveMode } from '@adl/shared';
import type { LlmClient, LlmResponse } from '@adl/shared';
import { loadBundle } from './bundle.js';
import { draftPostmortem } from './draft.js';
import { computeMetrics, parseIncidents } from './metrics.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Replace the model client. The demo and tests use this; the CLI itself never needs it. */
  llm?: LlmClient;
}

const USAGE = `Usage:
  postmortem draft --bundle DIR [--out DIR] [--live | --fixtures DIR]
  postmortem metrics --incidents FILE
Without --live (or DEMO_LIVE=1) or --fixtures, no model is called and the deterministic draft is written.`;

/** Stands in when no model is configured, so the draft takes the deterministic path. */
class NoModel implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('no model configured (use --live or --fixtures)');
  }
}

function selectLlm(live: boolean, fixtures: string | undefined, deps: CliDeps): LlmClient {
  if (deps.llm) return deps.llm;
  if (fixtures) return new RecordReplayLlm(fixtures, 'replay');
  if (live || isLiveMode(deps.env)) return new AnthropicLlm(deps.env);
  return new NoModel();
}

async function draft(args: string[], deps: CliDeps): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      bundle: { type: 'string' },
      out: { type: 'string', default: 'postmortem-out' },
      live: { type: 'boolean', default: false },
      fixtures: { type: 'string' },
    },
  });
  if (!values.bundle) {
    deps.err(USAGE);
    return 2;
  }
  const llm = selectLlm(values.live, values.fixtures, deps);
  const result = await draftPostmortem(loadBundle(values.bundle), llm);
  const out = values.out as string;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'postmortem.md'), result.markdown);
  writeFileSync(join(out, 'redaction-report.json'), `${JSON.stringify(result.report, null, 2)}\n`);
  const note = result.reason ? `; reason: ${result.reason}` : '';
  deps.out(`Draft written to ${join(out, 'postmortem.md')} (source: ${result.source}${note})`);
  const types = Object.entries(result.report.byType)
    .map(([type, c]) => `${type} ${c.occurrences}`)
    .join(', ');
  deps.out(`${result.report.total} values removed before the model call: ${types || 'none'}`);
  return 0;
}

function metrics(args: string[], deps: CliDeps): number {
  const { values } = parseArgs({ args, options: { incidents: { type: 'string' } } });
  if (!values.incidents) {
    deps.err(USAGE);
    return 2;
  }
  const m = computeMetrics(parseIncidents(readFileSync(values.incidents, 'utf8')));
  const fmt = (n: number | null, unit = ''): string => (n === null ? 'n/a' : `${n}${unit}`);
  deps.out(`Closed incidents: ${m.closed}`);
  deps.out(`With a postmortem: ${m.withPostmortem} (${fmt(m.pctWithPostmortem, '%')})`);
  deps.out(
    `Hours from close to publish: median ${fmt(m.hoursToPublish.median)}, p90 ${fmt(m.hoursToPublish.p90)} (n=${m.hoursToPublish.n})`,
  );
  return 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'draft') return await draft(rest, deps);
    if (command === 'metrics') return metrics(rest, deps);
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  deps.err(USAGE);
  return 2;
}
