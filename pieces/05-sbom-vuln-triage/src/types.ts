export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Negligible', 'Unknown'] as const;
export type Severity = (typeof SEVERITIES)[number];

export type Tier = 'P0' | 'P1' | 'P2' | 'P3';
export const TIERS: readonly Tier[] = ['P0', 'P1', 'P2', 'P3'];

/** A package listed in an SBOM. */
export interface Component {
  name: string;
  version: string;
  purl: string;
  type: string;
}

/** One vulnerability on one package, normalized from a Grype match. */
export interface Finding {
  app: string;
  /** The id Grype reported (CVE-... or GHSA-...). */
  id: string;
  /** The CVE used for KEV and EPSS lookups: the id itself, or the related CVE of a GHSA. */
  cve: string | null;
  package: string;
  version: string;
  purl: string;
  ecosystem: 'npm' | 'pypi' | 'other';
  severity: Severity;
  fixVersions: string[];
  fixState: string;
}

export const findingKey = (f: Pick<Finding, 'app' | 'id' | 'package'>): string =>
  `${f.app}|${f.id}|${f.package}`;

/** A day as YYYY-MM-DD (UTC). */
export type IsoDay = string;
