import { SOURCE_ORDER } from './types.js';
import type { RawEvent, TimelineEvent } from './types.js';

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Merge, sort, dedupe and number the events. Authors become participant-N (in order of first
 * appearance on the sorted timeline), and known author names inside text are replaced too, so the
 * draft stays blameless and names never reach the model.
 */
export function buildTimeline(events: RawEvent[]): TimelineEvent[] {
  const sorted = [...events]
    .map((e) => ({ ...e, text: collapse(e.text) }))
    .sort(
      (a, b) =>
        Date.parse(a.at) - Date.parse(b.at) ||
        SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
        a.text.localeCompare(b.text) ||
        (a.actor ?? '').localeCompare(b.actor ?? ''),
    );

  const seen = new Set<string>();
  const unique = sorted.filter((e) => {
    const key = [e.at, e.source, e.actor ?? '', e.text].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const pseudonyms = new Map<string, string>();
  for (const e of unique) {
    const name = e.actor?.trim().toLowerCase();
    if (name && !pseudonyms.has(name)) pseudonyms.set(name, `participant-${pseudonyms.size + 1}`);
  }
  const names = [...pseudonyms.keys()]
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  const namePattern = names.length
    ? new RegExp(`(?<![\\w-])(${names.map(escapeRegex).join('|')})(?![\\w-])`, 'gi')
    : null;

  const width = Math.max(2, String(unique.length).length);
  return unique.map((e, i) => {
    const { actor, ...rest } = e;
    return {
      ...rest,
      ...(actor ? { actor: pseudonyms.get(actor.trim().toLowerCase()) as string } : {}),
      text: namePattern
        ? e.text.replace(namePattern, (m) => pseudonyms.get(m.toLowerCase()) as string)
        : e.text,
      id: `E${String(i + 1).padStart(width, '0')}`,
    };
  });
}
