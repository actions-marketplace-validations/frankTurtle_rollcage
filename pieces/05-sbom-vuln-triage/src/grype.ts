import { z } from 'zod';
import { SEVERITIES } from './types.js';
import type { Finding, Severity } from './types.js';

const MatchSchema = z.object({
  vulnerability: z.object({
    id: z.string(),
    severity: z.string(),
    fix: z
      .object({ versions: z.array(z.string()).default([]), state: z.string().default('unknown') })
      .default({}),
  }),
  relatedVulnerabilities: z.array(z.object({ id: z.string() })).default([]),
  artifact: z.object({
    name: z.string(),
    version: z.string(),
    type: z.string().default(''),
    purl: z.string().default(''),
  }),
});

const GrypeSchema = z.object({ matches: z.array(MatchSchema) });

const toSeverity = (raw: string): Severity =>
  SEVERITIES.find((s) => s.toLowerCase() === raw.toLowerCase()) ?? 'Unknown';

const ecosystemOf = (purl: string, type: string): Finding['ecosystem'] => {
  if (purl.startsWith('pkg:npm/') || type === 'npm') return 'npm';
  if (purl.startsWith('pkg:pypi/') || type === 'python') return 'pypi';
  return 'other';
};

/** Normalize `grype -o json` output. Duplicate (id, package, version) matches collapse to one. */
export function parseGrype(json: unknown, app: string): Finding[] {
  const parsed = GrypeSchema.parse(json);
  const seen = new Map<string, Finding>();
  for (const m of parsed.matches) {
    const v = m.vulnerability;
    const a = m.artifact;
    const cve = v.id.startsWith('CVE-')
      ? v.id
      : (m.relatedVulnerabilities.find((r) => r.id.startsWith('CVE-'))?.id ?? null);
    const finding: Finding = {
      app,
      id: v.id,
      cve,
      package: a.name,
      version: a.version,
      purl: a.purl,
      ecosystem: ecosystemOf(a.purl, a.type),
      severity: toSeverity(v.severity),
      fixVersions: v.fix.versions,
      fixState: v.fix.state,
    };
    seen.set(`${v.id}|${a.name}|${a.version}`, finding);
  }
  return [...seen.values()];
}
