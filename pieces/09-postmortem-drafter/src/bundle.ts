import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseChat, parseCloudWatch, parseDeploys, parseNotes } from './ingest.js';
import { IncidentSchema } from './types.js';
import type { Bundle } from './types.js';

export const BUNDLE_FILES = ['incident.json', 'logs.json', 'chat.json', 'notes.md', 'deploys.json'];

/** Build a bundle from file contents keyed by file name. A missing file is `undefined`. */
export function parseBundleFiles(files: Record<string, string | undefined>): Bundle {
  const need = (name: string): string => {
    const text = files[name];
    if (text === undefined) throw new Error(`${name}: file is missing from the bundle`);
    return text;
  };
  let raw: unknown;
  try {
    raw = JSON.parse(need('incident.json'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('incident.json: not valid JSON');
    throw error;
  }
  const parsed = IncidentSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`incident.json: ${issue?.path.join('.')} ${issue?.message}`);
  }
  const incident = parsed.data;
  const chat = files['chat.json'];
  const notes = files['notes.md'];
  if (chat === undefined && notes === undefined) {
    throw new Error('chat.json: the bundle needs chat.json or notes.md');
  }
  return {
    incident,
    events: [
      ...parseCloudWatch(need('logs.json')),
      ...parseDeploys(need('deploys.json')),
      ...(chat === undefined ? [] : parseChat(chat)),
      ...(notes === undefined ? [] : parseNotes(notes, incident.opened_at)),
    ],
  };
}

export function loadBundle(dir: string): Bundle {
  const files: Record<string, string | undefined> = {};
  for (const name of BUNDLE_FILES) {
    const path = join(dir, name);
    files[name] = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  }
  return parseBundleFiles(files);
}
