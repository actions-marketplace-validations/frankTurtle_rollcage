import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { isLiveMode, type LlmClient } from '@adl/shared';
import { parseConftestOutput, toViolations, type ConftestRunner } from './conftest.js';
import { explainViolation } from './explain.js';
import { formatReport } from './format.js';
import { computeMetric, formatMetric, readLedger, recordEntries } from './ledger.js';
import { loadMapping, MAPPING_LABEL } from './mapping.js';
import { DEFAULT_POLICY_DIR } from './paths.js';
import type { Explanation, Stage } from './types.js';

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (text: string) => void;
  err: (text: string) => void;
  runner: ConftestRunner;
  /** Builds the model client. `live` is true for --live or DEMO_LIVE=1. */
  createLlm: (live: boolean) => LlmClient;
}

const USAGE = `Usage:
  policy-gates check [paths...] [--policy DIR] [--mapping FILE] [--ignore REGEX]
                     [--json] [--record LEDGER] [--explain [--live]]
  policy-gates metric --ledger FILE [--label TEXT]
  policy-gates record --ledger FILE --rule ID --stage pre-merge|post-deploy [--source TEXT]

Exit codes: 0 no violations, 1 violations, 2 usage or runner error.`;

const DEFAULT_IGNORE = '(^|/)(node_modules|\\.git)(/|$)';
const STAGES: readonly string[] = ['pre-merge', 'post-deploy'];

const OPTIONS = {
  policy: { type: 'string' },
  mapping: { type: 'string' },
  ignore: { type: 'string' },
  json: { type: 'boolean' },
  record: { type: 'string' },
  explain: { type: 'boolean' },
  live: { type: 'boolean' },
  ledger: { type: 'string' },
  label: { type: 'string' },
  rule: { type: 'string' },
  stage: { type: 'string' },
  source: { type: 'string' },
} as const;

type Values = ReturnType<
  typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>
>['values'];

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = argv;
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: OPTIONS,
      allowPositionals: true,
    });
    if (command === 'check') return await check(positionals, values, deps);
    if (command === 'metric') return metric(values, deps);
    if (command === 'record') return record(values, deps);
    deps.err(USAGE);
    return 2;
  } catch (error) {
    deps.err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

async function check(paths: string[], values: Values, deps: CliDeps): Promise<number> {
  const policy = values.policy ?? DEFAULT_POLICY_DIR;
  const mapping = loadMapping(values.mapping ?? join(policy, 'controls.json'));
  const output = await deps.runner.run({
    paths: paths.length > 0 ? paths : ['.'],
    policy,
    ignore: values.ignore ?? DEFAULT_IGNORE,
  });
  const violations = toViolations(parseConftestOutput(output), mapping);
  const passed = violations.length === 0;

  // The decision is made above from conftest alone. Nothing below can change it.
  const explanations: (Explanation | undefined)[] = [];
  if (values.explain && !passed) {
    const live = Boolean(values.live) || isLiveMode(deps.env);
    try {
      const llm = deps.createLlm(live);
      for (const v of violations) explanations.push(await explainViolation(llm, v));
    } catch (error) {
      deps.err(
        `explanations unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      explanations.length = 0;
    }
  }

  if (values.record && !passed) {
    recordEntries(
      values.record,
      violations.map((v) => ({ ruleId: v.ruleId, stage: 'pre-merge' as const, source: v.file })),
    );
  }

  if (values.json) {
    deps.out(
      JSON.stringify(
        {
          passed,
          label: MAPPING_LABEL,
          standard: mapping.standard,
          violations: violations.map((v, i) => ({ ...v, explanation: explanations[i] })),
        },
        null,
        2,
      ),
    );
  } else {
    deps.out(formatReport(violations, explanations));
  }
  return passed ? 0 : 1;
}

function metric(values: Values, deps: CliDeps): number {
  if (!values.ledger) throw new Error('metric needs --ledger FILE');
  deps.out(formatMetric(computeMetric(readLedger(values.ledger)), values.label));
  return 0;
}

function record(values: Values, deps: CliDeps): number {
  if (!values.ledger) throw new Error('record needs --ledger FILE');
  if (!values.rule) throw new Error('record needs --rule ID');
  if (!values.stage || !STAGES.includes(values.stage)) {
    throw new Error('record needs --stage pre-merge or post-deploy');
  }
  recordEntries(values.ledger, [
    {
      ruleId: values.rule,
      stage: values.stage as Stage,
      ...(values.source ? { source: values.source } : {}),
    },
  ]);
  deps.out(`Recorded ${values.rule} (${values.stage}) in ${values.ledger}`);
  return 0;
}
