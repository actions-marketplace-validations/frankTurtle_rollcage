/**
 * Writes fixtures/llm/*.json, the "recorded" model responses the demo replays.
 *
 * These are NOT output from a real model. No API key was used. A scripted stand-in writes
 * model-style replies from the same data the prompt carries, and RecordReplayLlm stores them under
 * the prompt's hash. To record real responses instead, run the demo with DEMO_LIVE=1 and a
 * RecordReplayLlm in record mode around AnthropicLlm.
 *
 * Run after any change to a prompt or to the demo inputs:
 *   pnpm --filter @adl/sbom-vuln-triage exec tsx demo/record-llm.ts
 */
import { RecordReplayLlm } from '@adl/shared';
import type { LlmClient, LlmRequest, LlmResponse } from '@adl/shared';
import { runCli } from '../src/cli.ts';
import { APP_ARGS, fixtures } from './args.ts';
import { join } from 'node:path';

interface NoteData {
  key: string;
  package: string;
  verdict: string;
  evidence: { ref: string; kind: string; text: string }[];
}

function reachabilityReply(data: { findings: NoteData[] }): string {
  const notes = data.findings.map((f) => {
    const imports = f.evidence.filter((e) => e.kind === 'import').map((e) => e.ref);
    const symbols = f.evidence.filter((e) => e.kind === 'symbol').map((e) => e.ref);
    const note =
      symbols.length > 0
        ? `${f.package} is imported at ${imports.join(', ')}, and a function name from the advisory appears at ${symbols.join(', ')}. The search does not show what data reaches that call. Assumption: request data can reach it.`
        : `${f.package} is imported at ${imports.join(', ')}. No function name from the advisory was found, so the search does not show use of the affected code. Assumption: other code may still use it indirectly.`;
    return { key: f.key, note, cites: f.evidence.map((e) => e.ref) };
  });
  return JSON.stringify({ notes });
}

interface Facts {
  apps: string[];
  unresolved: number;
  tiers: Record<string, number>;
  openCriticals: number;
  blocking: number;
  failOn: string;
  top: { id: string; package: string; why: string; action: string }[];
}

function leadershipReply(f: Facts): string {
  const urgent = f.top
    .slice(0, 3)
    .map((t) => `${t.id} in ${t.package} (${t.why}; ${t.action})`)
    .join(', ');
  return JSON.stringify({
    headline: `${f.tiers['P0']} of ${f.unresolved} open findings need action now.`,
    paragraphs: [
      `We scanned ${f.apps.join(' and ')}. ${f.unresolved} findings are open. ${f.tiers['P0']} need action now because they are on the known-exploited list or are rated Critical with a high estimated chance of exploitation. ${f.tiers['P1']} more belong in this sprint.`,
      `The most urgent are ${urgent}.`,
      `${f.openCriticals} open findings are rated Critical. A build gate set to fail on ${f.failOn} would stop ${f.blocking} of them from shipping until they are fixed or formally accepted.`,
    ],
    assumptions: [
      'The known-exploited and exploit-likelihood data is a demo snapshot, not the live catalogs.',
      'Code search shows where packages are mentioned, not whether the vulnerable code runs.',
    ],
  });
}

const standIn: LlmClient = {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const data: unknown = JSON.parse(request.prompt.slice(request.prompt.indexOf('\n') + 1));
    const text = (request.system ?? '').includes('reachability')
      ? reachabilityReply(data as { findings: NoteData[] })
      : leadershipReply(data as Facts);
    return { text, model: 'scripted-stand-in' };
  },
};

const llm = new RecordReplayLlm(join(fixtures, 'llm'), 'record', standIn);
const code = await runCli(['report', ...APP_ARGS, '--show', 'metrics'], {
  env: {},
  out: () => undefined,
  err: (t) => console.error(t),
  llm,
});
process.exitCode = code;
