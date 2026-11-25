import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runGate } from './gate.ts';
import { aggregateMetric, GateReportSchema, renderMetric } from './report.ts';
import type { GateReport } from './report.ts';
import { VERIFY_MODES } from './types.ts';
import type { CommandRunner, VerifyMode, VerifySpec } from './types.ts';

export interface CliDeps {
  runner: CommandRunner;
  out: (text: string) => void;
  err: (text: string) => void;
}

const DEFAULT_ISSUER = 'https://token.actions.githubusercontent.com';

const USAGE = `Usage:
  provenance gate --mode key|cosign-keyless|github-attestation --artifact PATH [--artifact PATH ...]
                  [--bundle PATH] [--report FILE]
                  key:                --public-key PATH [--allow-no-tlog]
                  cosign-keyless:     --cert-identity VALUE [--cert-oidc-issuer URL]
                  github-attestation: --repo OWNER/NAME [--signer-workflow PATH]
  provenance metric --report FILE [--report FILE ...]
Exit codes: 0 allow, 1 block, 2 bad usage.`;

class UsageError extends Error {}

const OPTIONS = {
  mode: { type: 'string' },
  artifact: { type: 'string', multiple: true },
  bundle: { type: 'string' },
  report: { type: 'string', multiple: true },
  'public-key': { type: 'string' },
  'allow-no-tlog': { type: 'boolean' },
  'cert-identity': { type: 'string' },
  'cert-oidc-issuer': { type: 'string' },
  repo: { type: 'string' },
  'signer-workflow': { type: 'string' },
} as const;

type Flags = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

function need(value: string | undefined, flag: string, mode: string): string {
  if (!value) throw new UsageError(`${flag} is required for --mode ${mode}`);
  return value;
}

/** Turn the flags into one verification spec per artifact. */
function buildSpecs(values: Flags): VerifySpec[] {
  const mode = values.mode as VerifyMode | undefined;
  if (!mode || !VERIFY_MODES.includes(mode)) {
    throw new UsageError(`--mode must be one of: ${VERIFY_MODES.join(', ')}`);
  }
  const artifacts = values.artifact ?? [];
  if (values.bundle && artifacts.length > 1) {
    throw new UsageError('--bundle works with one artifact; others use <artifact>.sigstore.json');
  }
  const bundleFor = (artifact: string): string => values.bundle ?? `${artifact}.sigstore.json`;

  switch (mode) {
    case 'key': {
      const publicKey = need(values['public-key'], '--public-key', mode);
      return artifacts.map((artifact) => ({
        mode,
        artifact,
        bundle: bundleFor(artifact),
        publicKey,
        allowNoTlog: values['allow-no-tlog'] === true,
      }));
    }
    case 'cosign-keyless': {
      const certIdentity = need(values['cert-identity'], '--cert-identity', mode);
      return artifacts.map((artifact) => ({
        mode,
        artifact,
        bundle: bundleFor(artifact),
        certIdentity,
        certOidcIssuer: values['cert-oidc-issuer'] ?? DEFAULT_ISSUER,
      }));
    }
    case 'github-attestation': {
      const repo = need(values.repo, '--repo', mode);
      return artifacts.map((artifact) => ({
        mode,
        artifact,
        repo,
        signerWorkflow: values['signer-workflow'],
        bundle: values.bundle,
      }));
    }
  }
}

function printGate(report: GateReport, out: (t: string) => void): void {
  for (const r of report.results) {
    out(`${r.status === 'verified' ? 'PASS' : 'FAIL'}  ${r.artifact}`);
    if (r.status === 'failed') out(`      ${r.reason}`);
  }
  out(renderMetric(report));
  out(report.decision === 'allow' ? 'Gate: ALLOW' : 'Gate: BLOCK (deploy must not continue)');
}

async function gateCommand(values: Flags, deps: CliDeps): Promise<number> {
  const specs = buildSpecs(values);
  const report = await runGate(specs, deps.runner);
  if (values.report?.[0]) writeFileSync(values.report[0], `${JSON.stringify(report, null, 2)}\n`);
  printGate(report, deps.out);
  return report.decision === 'allow' ? 0 : 1;
}

function metricCommand(values: Flags, deps: CliDeps): number {
  const paths = values.report ?? [];
  if (paths.length === 0) throw new UsageError('metric needs at least one --report FILE');
  const reports = paths.map((p) => {
    try {
      return GateReportSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
    } catch (e) {
      throw new UsageError(`cannot read gate report ${p}: ${e instanceof Error ? e.message : e}`);
    }
  });
  deps.out(renderMetric(aggregateMetric(reports)));
  return 0;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    });
    const [command] = positionals;
    if (command === 'gate') return await gateCommand(values, deps);
    if (command === 'metric') return metricCommand(values, deps);
    throw new UsageError(command ? `unknown command: ${command}` : 'a command is required');
  } catch (e) {
    deps.err(`error: ${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
}
