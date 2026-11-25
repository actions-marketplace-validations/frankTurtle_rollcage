import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeLlm } from '@adl/shared';
import { describe, expect, it } from 'vitest';
import { generateReachabilityNotes } from '../src/notes.ts';
import { buildSourceIndex, findEvidence, VERDICTS } from '../src/reachability.ts';
import type { Reachability } from '../src/reachability.ts';
import { parseSymbols } from '../src/symbols.ts';
import { fixtureJson, finding, NODE_SRC, nodeFindings, PY_SRC, pyFindings } from './helpers.ts';

const symbols = parseSymbols(fixtureJson('symbols.json'));
const node = buildSourceIndex(NODE_SRC);
const py = buildSourceIndex(PY_SRC);
const byId = (list: ReturnType<typeof nodeFindings>, id: string) => {
  const f = list.find((x) => x.id === id);
  if (!f) throw new Error(`missing ${id}`);
  return f;
};

describe('AC6: evidence carries file:line', () => {
  it('finds the import and the advisory function call for lodash merge', () => {
    const r = findEvidence(byId(nodeFindings(), 'CVE-2020-8203'), node, symbols);
    expect(r.verdict).toBe('import-and-symbol-found');
    expect(r.evidence.map((e) => `${e.kind} ${e.ref}`)).toEqual([
      'import src/server.js:3',
      'symbol src/server.js:10',
    ]);
    expect(r.evidence[1]?.text).toContain('_.merge');
  });

  it('reports an import only when no advisory function name appears', () => {
    const r = findEvidence(byId(nodeFindings(), 'GHSA-35jh-r3h4-6jhm'), node, symbols);
    expect(r.verdict).toBe('import-found');
    expect(r.evidence.map((e) => e.ref)).toEqual(['src/server.js:3']);
  });

  it('finds python imports and merges two symbols on one line into one entry', () => {
    const r = findEvidence(byId(pyFindings(), 'CVE-2020-14343'), py, symbols);
    expect(r.verdict).toBe('import-and-symbol-found');
    expect(r.evidence.map((e) => e.ref)).toEqual(['app/worker.py:2', 'app/worker.py:9']);
    expect(r.evidence[1]?.matched).toEqual(['yaml.load', 'FullLoader']);
  });

  it('finds a from-import', () => {
    const r = findEvidence(byId(pyFindings(), 'CVE-2020-28493'), py, symbols);
    expect(r.evidence.map((e) => e.ref)).toEqual(['app/worker.py:4']);
  });

  it('counts a function name only in a file that imports the package', () => {
    const dir = mkdtempSync(join(tmpdir(), 'src-'));
    writeFileSync(join(dir, 'a.js'), "const _ = require('lodash');\n_.merge(a, b);\n");
    writeFileSync(join(dir, 'b.js'), 'merge(a, b);\n');
    const r = findEvidence(
      finding({ id: 'CVE-2020-8203', package: 'lodash' }),
      buildSourceIndex(dir),
      symbols,
    );
    expect(r.evidence.map((e) => e.ref)).toEqual(['a.js:1', 'a.js:2']);
  });

  it('matches import forms: ES import, scoped name, subpath and python submodule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'src-'));
    writeFileSync(
      join(dir, 'a.ts'),
      'import { x } from \'@scope/pkg/sub\';\nimport lodash from "lodash/fp";\n',
    );
    writeFileSync(join(dir, 'b.py'), 'import yaml.constructor\nimport dateutil.parser, os\n');
    const idx = buildSourceIndex(dir);
    const ev = (f: Parameters<typeof findEvidence>[0]) =>
      findEvidence(f, idx, symbols).evidence.map((e) => e.ref);
    expect(ev(finding({ id: 'X1', package: '@scope/pkg' }))).toEqual(['a.ts:1']);
    expect(ev(finding({ id: 'X2', package: 'lodash' }))).toEqual(['a.ts:2']);
    expect(ev(finding({ id: 'X3', package: 'PyYAML', ecosystem: 'pypi' }))).toEqual(['b.py:1']);
    expect(ev(finding({ id: 'X4', package: 'python-dateutil', ecosystem: 'pypi' }))).toEqual([
      'b.py:2',
    ]);
  });

  it('skips node_modules, .git and virtualenv directories', () => {
    const dir = mkdtempSync(join(tmpdir(), 'src-'));
    for (const skip of ['node_modules', '.git', '.venv']) {
      mkdirSync(join(dir, skip));
      writeFileSync(join(dir, skip, 'x.js'), "require('lodash');\n");
    }
    expect(
      findEvidence(finding({ id: 'X', package: 'lodash' }), buildSourceIndex(dir), symbols).verdict,
    ).toBe('unknown');
  });

  it('returns an empty index for a missing directory', () => {
    expect(buildSourceIndex(join(tmpdir(), 'does-not-exist-sbom-triage')).files).toEqual([]);
  });
});

describe('AC7: no evidence means unknown', () => {
  it('gives unknown for packages the source never imports', () => {
    for (const id of ['CVE-2021-44906', 'GHSA-hrpp-h998-j3pp', 'CVE-2022-0235']) {
      const r = findEvidence(byId(nodeFindings(), id), node, symbols);
      expect(r.verdict).toBe('unknown');
      expect(r.evidence).toEqual([]);
    }
    expect(findEvidence(byId(pyFindings(), 'CVE-2022-22817'), py, symbols).verdict).toBe('unknown');
  });

  it('has no not-reachable verdict', () => {
    expect([...VERDICTS]).toEqual(['import-and-symbol-found', 'import-found', 'unknown']);
  });
});

describe('reachability notes from the model', () => {
  const evidence = findEvidence(byId(nodeFindings(), 'CVE-2020-8203'), node, symbols);
  const none: Reachability = { verdict: 'unknown', evidence: [] };
  const items = [
    {
      key: 'shop-api|CVE-2020-8203|lodash',
      id: 'CVE-2020-8203',
      package: 'lodash',
      reach: evidence,
    },
    {
      key: 'shop-api|CVE-2021-44906|minimist',
      id: 'CVE-2021-44906',
      package: 'minimist',
      reach: none,
    },
  ];
  const good = JSON.stringify({
    notes: [
      {
        key: items[0]?.key,
        note: 'lodash is imported at src/server.js:3 and merge is called at src/server.js:10. Assumption: req.query reaches merge.',
        cites: ['src/server.js:3', 'src/server.js:10'],
      },
    ],
  });

  it('uses valid model notes and writes a fixed note for no-evidence findings', async () => {
    const llm = new FakeLlm([good]);
    const result = await generateReachabilityNotes(llm, items);
    expect(result.source).toBe('model');
    expect(result.notes[items[0]?.key as string]).toContain('src/server.js:10');
    expect(result.notes[items[1]?.key as string]).toMatch(/unknown/i);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.prompt).not.toContain('minimist');
  });

  it('AC7: makes no model call when nothing has evidence', async () => {
    const llm = new FakeLlm([]);
    const result = await generateReachabilityNotes(llm, [items[1] as (typeof items)[number]]);
    expect(result.source).toBe('deterministic');
    expect(llm.calls).toHaveLength(0);
    expect(result.notes[items[1]?.key as string]).not.toMatch(/not reachable/i);
  });

  it('AC8: retries once on invalid output, then succeeds', async () => {
    const result = await generateReachabilityNotes(new FakeLlm(['not json', good]), items);
    expect(result.source).toBe('model');
  });

  it('AC8: falls back to deterministic notes, labeled, after two invalid replies', async () => {
    const result = await generateReachabilityNotes(new FakeLlm(['nope', 'still nope']), items);
    expect(result.source).toBe('fallback');
    expect(result.reason).toBeTruthy();
    expect(result.notes[items[0]?.key as string]).toContain('src/server.js:3');
    expect(result.notes[items[0]?.key as string]).toContain('src/server.js:10');
  });

  it('AC9: rejects a note that cites a location outside the evidence', async () => {
    const bad = JSON.stringify({
      notes: [{ key: items[0]?.key, note: 'See src/other.js:99.', cites: ['src/other.js:99'] }],
    });
    const result = await generateReachabilityNotes(new FakeLlm([bad, bad]), items);
    expect(result.source).toBe('fallback');
    expect(result.reason).toMatch(/cite/i);
  });

  it('AC9: rejects a note that claims the package is not reachable or exploitable', async () => {
    for (const phrase of ['lodash is not reachable here.', 'This is confirmed exploitable.']) {
      const bad = JSON.stringify({
        notes: [{ key: items[0]?.key, note: phrase, cites: ['src/server.js:3'] }],
      });
      const result = await generateReachabilityNotes(new FakeLlm([bad, bad]), items);
      expect(result.source).toBe('fallback');
    }
  });

  it('rejects notes for a key it was not given, and notes with no citation', async () => {
    const stray = JSON.stringify({
      notes: [{ key: 'nope', note: 'x', cites: ['src/server.js:3'] }],
    });
    const uncited = JSON.stringify({ notes: [{ key: items[0]?.key, note: 'x', cites: [] }] });
    expect((await generateReachabilityNotes(new FakeLlm([stray, stray]), items)).source).toBe(
      'fallback',
    );
    expect((await generateReachabilityNotes(new FakeLlm([uncited, uncited]), items)).source).toBe(
      'fallback',
    );
  });

  it('rejects a reply that leaves a finding with evidence without a note', async () => {
    const empty = JSON.stringify({ notes: [] });
    expect((await generateReachabilityNotes(new FakeLlm([empty, empty]), items)).source).toBe(
      'fallback',
    );
  });
});
