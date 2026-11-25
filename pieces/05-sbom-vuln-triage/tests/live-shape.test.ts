import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEpss, parseKev } from '../src/feeds.ts';

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
