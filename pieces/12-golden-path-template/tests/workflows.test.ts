import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkPins, findUses } from '../src/pins.ts';
import { scaffold } from '../src/scaffold.ts';
import { tempDir } from './helpers.ts';

let workflows: Record<string, string>;

beforeAll(() => {
  const root = join(tempDir(), 'svc');
  scaffold({ name: 'svc', owner: 'example-org', targetDir: root });
  const dir = join(root, '.github/workflows');
  workflows = Object.fromEntries(
    readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
  );
});

describe('pins (AC4)', () => {
  it('findUses returns every uses reference with its line number', () => {
    const text =
      'a:\n  - uses: actions/checkout@abc # v1\n  - uses: "./x.yml"\n  - run: echo uses: no';
    expect(findUses(text)).toEqual([
      { ref: 'actions/checkout@abc', line: 2 },
      { ref: './x.yml', line: 3 },
    ]);
  });

  it('every uses line in the generated workflows is local, a SHA, or the rollcage ref', () => {
    const result = checkPins(workflows, 'v0.4.0');
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('every third-party action is pinned to 40 hex characters', () => {
    for (const [file, text] of Object.entries(workflows)) {
      for (const { ref } of findUses(text)) {
        if (ref.startsWith('./') || ref.startsWith('frankTurtle/rollcage/')) continue;
        expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it('flags an unpinned third-party action', () => {
    const result = checkPins({ 'a.yml': 'steps:\n  - uses: actions/checkout@v4\n' }, 'v0.4.0');
    expect(result.errors).toEqual(['a.yml:2 actions/checkout@v4 is not pinned to a commit SHA']);
  });

  it('flags a rollcage reference that does not use the configured ref', () => {
    const result = checkPins(
      { 'a.yml': '  - uses: frankTurtle/rollcage/pieces/01-pr-risk-gate@main\n' },
      'v0.4.0',
    );
    expect(result.errors[0]).toMatch(/does not use the configured ref v0.4.0/);
  });

  it('flags a docker reference and a missing version', () => {
    const result = checkPins(
      { 'a.yml': '  - uses: docker://alpine:3\n  - uses: actions/checkout\n' },
      'v0.4.0',
    );
    expect(result.errors).toHaveLength(2);
  });

  it('accepts a SHA as the rollcage ref with no warning', () => {
    const sha = 'a'.repeat(40);
    const result = checkPins(
      { 'a.yml': `  - uses: frankTurtle/rollcage/pieces/01-pr-risk-gate@${sha}\n` },
      sha,
    );
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});

describe('reusable workflows (AC5)', () => {
  const reusable = [
    'build-test.yml',
    'gate-pr-risk.yml',
    'secrets-scan.yml',
    'sbom-vuln.yml',
    'policy-gates.yml',
    'provenance.yml',
  ];

  it.each(reusable)('%s declares workflow_call and top-level permissions', (file) => {
    const text = workflows[file];
    expect(text, file).toBeDefined();
    expect(text).toMatch(/^on:\n {2}workflow_call:/m);
    expect(text).toMatch(/^permissions:\n {2}contents: read/m);
  });

  it('checkout never persists credentials', () => {
    for (const [file, text] of Object.entries(workflows)) {
      const checkouts = text.match(/actions\/checkout@/g)?.length ?? 0;
      const guarded = text.match(/persist-credentials: false/g)?.length ?? 0;
      expect(guarded, file).toBe(checkouts);
    }
  });
});

describe('ci.yml wiring (AC6)', () => {
  it('calls every reusable workflow', () => {
    const ci = workflows['ci.yml'] ?? '';
    for (const f of [
      'build-test',
      'gate-pr-risk',
      'secrets-scan',
      'sbom-vuln',
      'policy-gates',
      'provenance',
    ]) {
      expect(ci).toContain(`uses: ./.github/workflows/${f}.yml`);
    }
  });

  it('wires pieces 01, 05, 06 and 10 by the agreed contract with one ref', () => {
    expect(workflows['gate-pr-risk.yml']).toContain(
      'frankTurtle/rollcage/pieces/01-pr-risk-gate@v0.4.0',
    );
    const sbom = workflows['sbom-vuln.yml'] ?? '';
    expect(sbom).toContain('frankTurtle/rollcage/pieces/05-sbom-vuln-triage@v0.4.0');
    expect(sbom).toMatch(/path: /);
    expect(sbom).toMatch(/fail-on: /);
    const policy = workflows['policy-gates.yml'] ?? '';
    expect(policy).toContain('frankTurtle/rollcage/pieces/06-policy-gates@v0.4.0');
    expect(policy).toMatch(/path: /);
    const prov = workflows['provenance.yml'] ?? '';
    expect(prov).toContain('frankTurtle/rollcage/pieces/10-provenance-signing@v0.4.0');
    expect(prov).toMatch(/artifact: /);
    expect(prov).toMatch(/mode: /);
  });

  it('piece 04 is the gitleaks scan from its template', () => {
    expect(workflows['secrets-scan.yml']).toContain('gitleaks/gitleaks-action@');
  });

  it('only the risk gate job is granted pull-requests: write', () => {
    const ci = workflows['ci.yml'] ?? '';
    expect(ci.match(/pull-requests: write/g)?.length).toBe(1);
  });
});
