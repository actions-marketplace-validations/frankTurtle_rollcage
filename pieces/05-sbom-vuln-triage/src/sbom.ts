import { z } from 'zod';
import type { Component } from './types.js';

const SbomSchema = z.object({
  bomFormat: z.literal('CycloneDX'),
  components: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        version: z.string().optional(),
        purl: z.string().optional(),
      }),
    )
    .default([]),
});

/** Library components of a CycloneDX document. File entries and unversioned items are skipped. */
export function parseSbom(json: unknown): Component[] {
  const parsed = SbomSchema.safeParse(json);
  if (!parsed.success)
    throw new Error('not a CycloneDX JSON document (bomFormat must be CycloneDX)');
  return parsed.data.components.flatMap((c) =>
    c.type === 'library' && c.version
      ? [
          {
            name: c.name,
            version: c.version,
            purl: c.purl ?? `pkg:generic/${c.name}@${c.version}`,
            type: c.type,
          },
        ]
      : [],
  );
}

export interface VersionChange {
  name: string;
  from: string;
  to: string;
}

export interface SbomDiff {
  added: Component[];
  removed: Component[];
  upgraded: VersionChange[];
  downgraded: VersionChange[];
  unchanged: number;
}

/** The purl without its version, so the same package matches across releases. */
const identity = (c: Component): string => c.purl.replace(/@[^?#]*/, '');

/** Numeric segments compare as numbers, anything else as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    if (x === y) continue;
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
    if (numeric) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

export function diffSboms(from: Component[], to: Component[]): SbomDiff {
  const before = new Map(from.map((c) => [identity(c), c]));
  const after = new Map(to.map((c) => [identity(c), c]));
  const diff: SbomDiff = { added: [], removed: [], upgraded: [], downgraded: [], unchanged: 0 };
  for (const [key, c] of after) {
    const old = before.get(key);
    if (!old) diff.added.push(c);
    else if (old.version === c.version) diff.unchanged += 1;
    else {
      const change = { name: c.name, from: old.version, to: c.version };
      (compareVersions(old.version, c.version) < 0 ? diff.upgraded : diff.downgraded).push(change);
    }
  }
  for (const [key, c] of before) if (!after.has(key)) diff.removed.push(c);
  diff.added.sort(byName);
  diff.removed.sort(byName);
  diff.upgraded.sort(byName);
  diff.downgraded.sort(byName);
  return diff;
}

export function renderDiff(diff: SbomDiff, fromLabel: string, toLabel: string): string {
  const lines = [`SBOM diff: ${fromLabel} -> ${toLabel}`];
  const section = (title: string, rows: string[]): void => {
    if (rows.length === 0) return;
    lines.push(`  ${title} (${rows.length})`, ...rows.map((r) => `    ${r}`));
  };
  const changes = (list: VersionChange[]): string[] =>
    list.map((c) => `${c.name} ${c.from} -> ${c.to}`);
  section(
    'added',
    diff.added.map((c) => `${c.name} ${c.version}`),
  );
  section(
    'removed',
    diff.removed.map((c) => `${c.name} ${c.version}`),
  );
  section('upgraded', changes(diff.upgraded));
  section('downgraded', changes(diff.downgraded));
  const touched =
    diff.added.length + diff.removed.length + diff.upgraded.length + diff.downgraded.length;
  if (touched === 0) lines.push('  No changes.');
  lines.push(`  ${diff.unchanged} unchanged`);
  return lines.join('\n');
}
