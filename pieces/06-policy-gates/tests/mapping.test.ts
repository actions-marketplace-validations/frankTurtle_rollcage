import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMapping, MAPPING_LABEL } from '../src/mapping.js';
import { MAPPING_PATH, POLICY_DIR } from './helpers.js';

function regoSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return regoSources(path);
    return entry.name.endsWith('.rego') && !entry.name.endsWith('_test.rego')
      ? [readFileSync(path, 'utf8')]
      : [];
  });
}

describe('controls mapping', () => {
  const mapping = loadMapping(MAPPING_PATH);

  it('is labeled as an illustrative mapping, not a compliance attestation', () => {
    expect(MAPPING_LABEL).toBe('illustrative mapping, not a compliance attestation');
    expect(mapping.label).toBe(MAPPING_LABEL);
  });

  it('has an entry for every rule ID that a Rego rule can emit', () => {
    const ids = new Set(
      regoSources(POLICY_DIR).flatMap((src) => [...src.matchAll(/"(PG\d{3}):/g)].map((m) => m[1])),
    );
    expect(ids.size).toBe(6);
    expect(Object.keys(mapping.rules).sort()).toEqual([...ids].sort());
  });

  it('maps each rule to NIST SP 800-171 control IDs and gives a fix', () => {
    for (const rule of Object.values(mapping.rules)) {
      expect(rule.controls.length).toBeGreaterThan(0);
      for (const id of rule.controls) expect(id).toMatch(/^3\.\d{1,2}\.\d{1,2}$/);
      expect(rule.remediation.length).toBeGreaterThan(10);
    }
  });

  it('rejects a mapping file that is missing the label or has bad control IDs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-map-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(
      bad,
      JSON.stringify({
        label: 'x',
        standard: 's',
        rules: { PG001: { title: 't', controls: ['x'] } },
      }),
    );
    expect(() => loadMapping(bad)).toThrow();
    expect(() => loadMapping(join(dir, 'missing.json'))).toThrow(/mapping/i);
  });
});
