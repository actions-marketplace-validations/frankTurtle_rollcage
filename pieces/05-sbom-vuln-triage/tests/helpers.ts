import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGrype } from '../src/grype.ts';
import type { Feeds } from '../src/feeds.ts';
import type { Finding, Severity } from '../src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const PIECE = join(here, '..');
export const FIXTURES = join(PIECE, 'fixtures');
export const NODE_SRC = join(PIECE, 'demo', 'apps', 'node-app');
export const PY_SRC = join(PIECE, 'demo', 'apps', 'python-app');

export const fixturePath = (name: string): string => join(FIXTURES, name);
export const fixtureText = (name: string): string => readFileSync(fixturePath(name), 'utf8');
export const fixtureJson = (name: string): unknown => JSON.parse(fixtureText(name));

export const nodeFindings = (): Finding[] =>
  parseGrype(fixtureJson('grype-node-app.json'), 'shop-api');
export const pyFindings = (): Finding[] =>
  parseGrype(fixtureJson('grype-python-app.json'), 'report-worker');

/** A finding with sensible defaults, for rule tests. */
export function finding(over: Partial<Finding> & { id: string }): Finding {
  return {
    app: 'app',
    cve: over.id.startsWith('CVE-') ? over.id : null,
    package: 'pkg',
    version: '1.0.0',
    purl: `pkg:npm/${over.package ?? 'pkg'}@1.0.0`,
    ecosystem: 'npm',
    severity: 'High' as Severity,
    fixVersions: ['1.0.1'],
    fixState: 'fixed',
    ...over,
  };
}

export const feeds = (kev: string[] = [], epss: Record<string, number> = {}): Feeds => ({
  kev: new Set(kev),
  epss: new Map(Object.entries(epss)),
  source: 'test',
});
