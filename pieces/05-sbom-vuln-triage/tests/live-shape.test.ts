import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEpss, parseKev } from '../src/feeds.ts';
import { parseGrype } from '../src/grype.ts';
import { parseSbom } from '../src/sbom.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'live-shape');
const read = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'));

// Real responses captured on 2026-11-25 and trimmed. They pin the live shapes the parsers rely on.
describe('live feed shapes (captured 2026-11-25)', () => {
  it('parses the real CISA KEV catalog shape', () => {
    const kev = parseKev(read('kev-2026-11-25.json'));
    expect(kev.size).toBeGreaterThan(0);
    for (const id of kev) expect(id).toMatch(/^CVE-\d{4}-\d+$/);
  });

  it('parses the real FIRST EPSS response, including scores sent as strings', () => {
    const epss = parseEpss(read('epss-2026-11-25.json'));
    expect(epss.size).toBe(2);
    for (const score of epss.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// Captured by running syft 1.57.2 and grype 0.122.1 (DB built 2026-11-25) on demo/apps/node-app.
describe('real syft and grype output (captured 2026-11-25)', () => {
  it('parses a real syft CycloneDX 1.7 SBOM', () => {
    const components = parseSbom(read('syft-real-2026-11-25.cdx.json'));
    expect(components.map((c) => c.name)).toEqual(expect.arrayContaining(['axios', 'express']));
    for (const c of components) expect(c.purl).toMatch(/^pkg:npm\//);
  });

  it('parses a real grype report, taking the CVE from relatedVulnerabilities for GHSA matches', () => {
    const findings = parseGrype(read('grype-real-2026-11-25.json'), 'shop-api');
    expect(findings.length).toBeGreaterThan(20);
    const ghsa = findings.filter((f) => f.id.startsWith('GHSA-') && f.cve !== null);
    expect(ghsa.length).toBeGreaterThan(0);
    for (const f of ghsa) expect(f.cve).toMatch(/^CVE-\d{4}-\d+$/);
    for (const f of findings) expect(f.ecosystem).toBe('npm');
  });
});
