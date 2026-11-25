import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.ts';
import type { CliDeps } from '../src/cli.ts';
import { runSyftAndGrype, spawnRunner } from '../src/live.ts';
import type { Runner } from '../src/live.ts';
import { fixtureText, fixturePath, NODE_SRC, PIECE, PY_SRC } from './helpers.ts';

function harness(extra: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    env: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...extra,
  };
  return { deps, out, err, text: () => out.join('\n'), errText: () => err.join('\n') };
}

const DEMO_ARGS = [
  ...['--app', `shop-api:${fixturePath('grype-node-app.json')}:${NODE_SRC}`],
  ...['--app', `report-worker:${fixturePath('grype-python-app.json')}:${PY_SRC}`],
  ...['--history', fixturePath('history.json')],
  ...['--waivers', fixturePath('waivers.json')],
  ...['--as-of', '2026-11-25'],
];

describe('report command, offline', () => {
  it('prints the prioritized table, evidence and the waived count from fixtures', async () => {
    const h = harness();
    const dir = mkdtempSync(join(tmpdir(), 'out-'));
    const code = await runCli(['report', ...DEMO_ARGS, '--out', dir], h.deps);
    expect(code).toBe(0);
    const text = h.text();
    expect(text).toContain('P0');
    expect(text).toContain('CVE-2020-14343');
    expect(text).toContain('app/worker.py:9');
    expect(text).toMatch(/Pillow.*unknown/s);
    expect(text).toMatch(/waived: 1/i);
    for (const f of ['findings.json', 'report.md', 'leadership.md']) {
      expect(existsSync(join(dir, f))).toBe(true);
    }
    const json = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8')) as {
      items: unknown[];
      metrics: { openCriticals: number };
    };
    expect(json.items).toHaveLength(19);
    expect(json.metrics.openCriticals).toBe(4);
  });

  it('answers from the recorded model responses, so the demo notes are not fallbacks', async () => {
    const h = harness();
    await runCli(['report', ...DEMO_ARGS], h.deps);
    expect(h.text()).not.toMatch(/deterministic fallback/i);
    expect(h.text()).toMatch(/notes: recorded model response/i);
  });

  it('is deterministic across runs', async () => {
    const a = harness();
    const b = harness();
    await runCli(['report', ...DEMO_ARGS], a.deps);
    await runCli(['report', ...DEMO_ARGS], b.deps);
    expect(a.text()).toBe(b.text());
  });

  it('falls back and says so when a recording is missing', async () => {
    const h = harness();
    await runCli(['report', ...DEMO_ARGS, '--epss-threshold', '0.9'], h.deps);
    expect(h.text()).toMatch(/deterministic fallback/i);
  });

  it('fails with exit 2 and a message when --llm-live has no API key', async () => {
    const h = harness();
    expect(await runCli(['report', ...DEMO_ARGS, '--llm-live'], h.deps)).toBe(2);
    expect(h.errText()).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('DEMO_LIVE=1 also selects the live model, with the same key check', async () => {
    const h = harness({ env: { DEMO_LIVE: '1' } });
    expect(await runCli(['report', ...DEMO_ARGS], h.deps)).toBe(2);
  });
});

describe('AC13: gate command', () => {
  it('exits 1 and names the findings that block the build', async () => {
    const h = harness();
    const code = await runCli(['gate', ...DEMO_ARGS, '--fail-on', 'critical'], h.deps);
    expect(code).toBe(1);
    expect(h.text()).toMatch(/GATE: FAIL/);
    expect(h.text()).toContain('CVE-2020-14343');
    expect(h.text()).toMatch(/in KEV/);
    expect(h.text()).toMatch(/EPSS 0\.60/);
  });

  it('exits 0 when nothing at or above fail-on is in KEV or above the threshold', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
    const kev = join(dir, 'kev.json');
    writeFileSync(kev, JSON.stringify({ vulnerabilities: [] }));
    const h = harness();
    const code = await runCli(
      ['gate', ...DEMO_ARGS, '--kev', kev, '--epss-threshold', '0.99', '--fail-on', 'critical'],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.text()).toMatch(/GATE: PASS/);
  });

  it('writes an audit line when --audit is given', async () => {
    const audit = join(mkdtempSync(join(tmpdir(), 'audit-')), 'gate.jsonl');
    await runCli(['gate', ...DEMO_ARGS, '--audit', audit], harness().deps);
    expect(readFileSync(audit, 'utf8')).toContain('sbom-triage.gate');
  });

  it('rejects a bad --fail-on value', async () => {
    const h = harness();
    expect(await runCli(['gate', ...DEMO_ARGS, '--fail-on', 'severe'], h.deps)).toBe(2);
    expect(h.errText()).toMatch(/fail-on/);
  });
});

describe('metrics and diff commands', () => {
  it('prints the three metrics with the assumption', async () => {
    const h = harness();
    expect(await runCli(['metrics', ...DEMO_ARGS], h.deps)).toBe(0);
    expect(h.text()).toMatch(/Open criticals: 4/);
    expect(h.text()).toMatch(/Mean time to remediate: 23\.1 days/);
    expect(h.text()).toMatch(/15 min per finding \(assumption\)/);
  });

  it('prints "no data" for MTTR when no history is given', async () => {
    const h = harness();
    const args = DEMO_ARGS.filter((_, i) => i < 4);
    await runCli(['metrics', ...args], h.deps);
    expect(h.text()).toMatch(/no data/);
  });

  it('diffs two SBOM files', async () => {
    const h = harness();
    const code = await runCli(
      [
        'diff',
        '--from',
        fixturePath('node-app-1.0.0.cdx.json'),
        '--to',
        fixturePath('node-app.cdx.json'),
      ],
      h.deps,
    );
    expect(code).toBe(0);
    expect(h.text()).toContain('jsonwebtoken');
    expect(h.text()).toContain('lodash 4.17.11 -> 4.17.15');
  });
});

describe('usage errors', () => {
  it('prints usage for an unknown command or no command', async () => {
    const h = harness();
    expect(await runCli(['bogus'], h.deps)).toBe(2);
    expect(await runCli([], h.deps)).toBe(2);
    expect(h.errText()).toMatch(/Usage/);
  });

  it('needs --app or --live --path', async () => {
    const h = harness();
    expect(await runCli(['report'], h.deps)).toBe(2);
    expect(h.errText()).toMatch(/--app/);
  });

  it('rejects a malformed --app value and a missing file', async () => {
    const h = harness();
    expect(await runCli(['report', '--app', 'only-a-name'], h.deps)).toBe(2);
    expect(await runCli(['report', '--app', 'a:/nope/grype.json:/nope'], h.deps)).toBe(2);
  });
});

describe('AC15: live mode goes through the injected runner only', () => {
  const sbom = fixtureText('node-app.cdx.json');
  const grype = fixtureText('grype-node-app.json');

  function fakeRunner(calls: string[][]): Runner {
    return async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (cmd === 'syft') return { status: 0, stdout: sbom, stderr: '' };
      return { status: 0, stdout: grype, stderr: '' };
    };
  }

  it('runs syft on the directory, then grype on the SBOM it wrote', async () => {
    const calls: string[][] = [];
    const result = await runSyftAndGrype(NODE_SRC, fakeRunner(calls));
    expect(calls[0]).toEqual(['syft', `dir:${NODE_SRC}`, '-q', '-o', 'cyclonedx-json']);
    expect(calls[1]?.slice(0, 2)).toEqual([
      'grype',
      expect.stringMatching(/^sbom:.*sbom\.cdx\.json$/),
    ]);
    expect(calls[1]?.slice(2)).toEqual(['-q', '-o', 'json']);
    expect(result.sbom).toBe(sbom);
    expect(result.grype).toBe(grype);
  });

  it('reports a missing tool and a failing tool', async () => {
    const missing: Runner = async () => {
      throw Object.assign(new Error('spawn syft ENOENT'), { code: 'ENOENT' });
    };
    await expect(runSyftAndGrype(NODE_SRC, missing)).rejects.toThrow(/syft.*PATH/);
    const failing: Runner = async () => ({ status: 1, stdout: '', stderr: 'db is empty' });
    await expect(runSyftAndGrype(NODE_SRC, failing)).rejects.toThrow(/db is empty/);
  });

  it('the CLI --live path uses the runner and, with --live-feeds, the injected fetch', async () => {
    const calls: string[][] = [];
    const urls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      urls.push(url);
      const body = url.includes('first.org')
        ? { data: [{ cve: 'CVE-2021-44906', epss: '0.9' }] }
        : { vulnerabilities: [{ cveID: 'CVE-2021-44906' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const h = harness({ runner: fakeRunner(calls), fetchImpl });
    const code = await runCli(
      ['gate', '--live', '--live-feeds', '--path', NODE_SRC, '--as-of', '2026-11-25'],
      h.deps,
    );
    expect(code).toBe(1);
    expect(calls.map((c) => c[0])).toEqual(['syft', 'grype']);
    expect(urls.some((u) => u.includes('known_exploited_vulnerabilities'))).toBe(true);
    expect(h.text()).toMatch(/feeds: live/i);
  });

  it('default runs never call a runner or fetch', async () => {
    const runner: Runner = async () => {
      throw new Error('runner must not be called');
    };
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('fetch must not be called');
    };
    const h = harness({ runner, fetchImpl });
    expect(await runCli(['report', ...DEMO_ARGS], h.deps)).toBe(0);
  });

  it('--live needs --path', async () => {
    const h = harness();
    expect(await runCli(['report', '--live'], h.deps)).toBe(2);
  });
});

describe('AC16: action.yml', () => {
  const action = parse(readFileSync(join(PIECE, 'action.yml'), 'utf8')) as {
    inputs: Record<string, { default?: string }>;
    runs: { using: string; steps: { run?: string; uses?: string }[] };
  };

  it('is a composite action with path and fail-on inputs and the documented defaults', () => {
    expect(action.runs.using).toBe('composite');
    expect(action.inputs['path']?.default).toBe('.');
    expect(action.inputs['fail-on']?.default).toBe('critical');
    expect(action.inputs['epss-threshold']?.default).toBe('0.1');
    expect(action.inputs['live-feeds']?.default).toBe('true');
  });

  it('runs syft, grype and the gate, and every uses: is pinned by SHA', () => {
    const scripts = JSON.stringify(action.runs.steps);
    expect(scripts).toContain('syft');
    expect(scripts).toContain('grype');
    expect(scripts).toContain('gate');
    for (const step of action.runs.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[0-9a-f]{40}/);
    }
  });
});

describe('spawnRunner', () => {
  it('runs a program with an argument list and captures output and status', async () => {
    const ok = await spawnRunner(process.execPath, ['-e', 'console.log("hi")']);
    expect(ok).toMatchObject({ status: 0, stdout: 'hi\n' });
    const bad = await spawnRunner(process.execPath, ['-e', 'process.exit(3)']);
    expect(bad.status).toBe(3);
  });

  it('rejects with ENOENT for a program that does not exist', async () => {
    await expect(spawnRunner('definitely-not-a-real-program-xyz', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
