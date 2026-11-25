import { readFileSync } from 'node:fs';
import type { FetchLike } from '@adl/shared';
import { z } from 'zod';

export interface Feeds {
  /** CVE ids in the CISA Known Exploited Vulnerabilities catalog. */
  kev: Set<string>;
  /** CVE id to EPSS score (0 to 1). */
  epss: Map<string, number>;
  /** 'snapshot' for committed files, 'live' after a fetch, anything else for tests. */
  source: string;
}

export const KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
export const EPSS_URL = 'https://api.first.org/data/v1/epss';
/** Keeps the query string short. */
const EPSS_BATCH = 100;

const KevSchema = z.object({ vulnerabilities: z.array(z.object({ cveID: z.string() })) });
const EpssSchema = z.object({
  data: z.array(z.object({ cve: z.string(), epss: z.coerce.number() })),
});

export const parseKev = (json: unknown): Set<string> =>
  new Set(KevSchema.parse(json).vulnerabilities.map((v) => v.cveID));

export const parseEpss = (json: unknown): Map<string, number> =>
  new Map(EpssSchema.parse(json).data.map((d) => [d.cve, d.epss]));

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

export function loadSnapshotFeeds(kevPath: string, epssPath: string): Feeds {
  return {
    kev: parseKev(readJson(kevPath)),
    epss: parseEpss(readJson(epssPath)),
    source: 'snapshot',
  };
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
  return res.json();
}

export async function fetchKev(fetchImpl: FetchLike): Promise<Set<string>> {
  return parseKev(await getJson(fetchImpl, KEV_URL));
}

export async function fetchEpss(
  fetchImpl: FetchLike,
  cves: readonly string[],
): Promise<Map<string, number>> {
  const batches: string[][] = [];
  for (let i = 0; i < cves.length; i += EPSS_BATCH) batches.push(cves.slice(i, i + EPSS_BATCH));
  const pages = await Promise.all(
    batches.map((batch) => getJson(fetchImpl, `${EPSS_URL}?cve=${batch.join(',')}`)),
  );
  return new Map(pages.flatMap((page) => [...parseEpss(page)]));
}
