import { describe, expect, it } from 'vitest';
import { fetchEpss, fetchKev, loadSnapshotFeeds, parseEpss, parseKev } from '../src/feeds.ts';
import { parseGrype } from '../src/grype.ts';
import { parseSbom } from '../src/sbom.ts';
import { fixtureJson, fixturePath, nodeFindings, pyFindings } from './helpers.ts';

describe('AC1: parse Syft CycloneDX and Grype output', () => {
  it('reads library components from a Syft SBOM and skips file entries', () => {
    const components = parseSbom(fixtureJson('node-app.cdx.json'));
    const names = components.map((c) => c.name);
    expect(names).toContain('lodash');
    expect(names).not.toContain('/package-lock.json');
    expect(components.find((c) => c.name === 'lodash')).toMatchObject({
      version: '4.17.15',
      purl: 'pkg:npm/lodash@4.17.15',
    });
  });

  it('rejects a document that is not CycloneDX', () => {
    expect(() => parseSbom({ bomFormat: 'SPDX' })).toThrow(/CycloneDX/);
  });

  it('normalizes Grype matches into findings', () => {
    const findings = nodeFindings();
    expect(findings).toHaveLength(10);
    const minimist = findings.find((f) => f.id === 'CVE-2021-44906');
    expect(minimist).toMatchObject({
      app: 'shop-api',
      package: 'minimist',
      version: '1.2.5',
      severity: 'Critical',
      fixVersions: ['1.2.6'],
      fixState: 'fixed',
      ecosystem: 'npm',
      cve: 'CVE-2021-44906',
    });
    expect(pyFindings()).toHaveLength(10);
    expect(pyFindings().find((f) => f.package === 'PyYAML')?.ecosystem).toBe('pypi');
  });

  it('maps unknown severities to Unknown and collapses duplicate matches', () => {
    const base = fixtureJson('grype-node-app.json') as { matches: Record<string, unknown>[] };
    const first = base.matches[0] as { vulnerability: Record<string, unknown> };
    const odd = {
      ...first,
      vulnerability: { ...first.vulnerability, severity: 'Weird' },
    };
    const findings = parseGrype({ matches: [first, first, odd] }, 'x');
    expect(findings).toHaveLength(1);
    const only = parseGrype({ matches: [odd] }, 'x');
    expect(only[0]?.severity).toBe('Unknown');
  });

  it('AC4 input: a GHSA id carries its related CVE as the lookup id', () => {
    const ghsa = nodeFindings().find((f) => f.id === 'GHSA-hrpp-h998-j3pp');
    expect(ghsa?.cve).toBe('CVE-2022-24999');
  });

  it('rejects a Grype document with no matches array', () => {
    expect(() => parseGrype({ nope: 1 }, 'x')).toThrow();
  });
});

describe('KEV and EPSS feeds', () => {
  it('parses the snapshot fixtures', () => {
    const feeds = loadSnapshotFeeds(
      fixturePath('kev-snapshot.json'),
      fixturePath('epss-snapshot.json'),
    );
    expect(feeds.kev.has('CVE-2020-14343')).toBe(true);
    expect(feeds.kev.has('CVE-2021-44906')).toBe(false);
    expect(feeds.epss.get('CVE-2022-22817')).toBeCloseTo(0.6);
    expect(feeds.source).toBe('snapshot');
  });

  it('parses EPSS scores sent as strings', () => {
    const map = parseEpss({ data: [{ cve: 'CVE-1', epss: '0.25' }] });
    expect(map.get('CVE-1')).toBe(0.25);
  });

  it('parses a KEV document', () => {
    expect(parseKev({ vulnerabilities: [{ cveID: 'CVE-9' }] }).has('CVE-9')).toBe(true);
  });

  it('fetches both feeds through an injected fetch, with CVE ids in the EPSS query', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      urls.push(url);
      const body = url.includes('first.org')
        ? { data: [{ cve: 'CVE-1', epss: '0.5' }] }
        : { vulnerabilities: [{ cveID: 'CVE-1' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const kev = await fetchKev(fetchImpl);
    const epss = await fetchEpss(fetchImpl, ['CVE-1', 'CVE-2']);
    expect(kev.has('CVE-1')).toBe(true);
    expect(epss.get('CVE-1')).toBe(0.5);
    expect(urls.some((u) => u.includes('cve=CVE-1,CVE-2'))).toBe(true);
  });

  it('batches long EPSS queries and skips the call when there are no ids', async () => {
    let calls = 0;
    const fetchImpl = async (): Promise<Response> => {
      calls += 1;
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    expect((await fetchEpss(fetchImpl, [])).size).toBe(0);
    expect(calls).toBe(0);
    const ids = Array.from({ length: 120 }, (_, i) => `CVE-2020-${1000 + i}`);
    await fetchEpss(fetchImpl, ids);
    expect(calls).toBe(2);
  });

  it('throws a clear error on a failed fetch', async () => {
    const fetchImpl = async (): Promise<Response> => new Response('no', { status: 503 });
    await expect(fetchKev(fetchImpl)).rejects.toThrow(/503/);
    await expect(fetchEpss(fetchImpl, ['CVE-1'])).rejects.toThrow(/503/);
  });
});
