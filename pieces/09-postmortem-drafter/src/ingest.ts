import { z } from 'zod';
import type { RawEvent } from './types.js';

const NO_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Turn an ISO string (zone or not, read as UTC), epoch seconds or epoch milliseconds into ISO UTC. */
export function toIso(value: string | number): string {
  let ms: number;
  const numeric =
    typeof value === 'number' ? value : /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  if (!Number.isNaN(numeric)) {
    ms = numeric < 1e11 ? numeric * 1000 : numeric;
  } else {
    const text = String(value).trim();
    ms = Date.parse(NO_ZONE.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  }
  if (Number.isNaN(ms)) throw new Error(`not a valid time: ${String(value)}`);
  return new Date(ms).toISOString();
}

const time = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try {
    return toIso(v);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message });
    return z.NEVER;
  }
});

/** Parse a JSON file's text with a schema; errors name the file. */
export function parseJson<T>(
  file: string,
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')} ` : '';
    throw new Error(`${file}: ${where}${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
}

const CloudWatchEvent = z.object({ timestamp: time, message: z.string() });
const CloudWatchFile = z.union([
  z.array(CloudWatchEvent),
  z.object({ events: z.array(CloudWatchEvent) }).transform((v) => v.events),
]);

/** CloudWatch `filter-log-events` output, or an array of its events. */
export function parseCloudWatch(text: string): RawEvent[] {
  return parseJson('logs.json', text, CloudWatchFile).map((e) => ({
    at: e.timestamp,
    source: 'log',
    text: e.message.trim(),
  }));
}

const ChatMessage = z.object({ ts: time, user: z.string().min(1), text: z.string() });

export function parseChat(text: string): RawEvent[] {
  return parseJson('chat.json', text, z.array(ChatMessage)).map((m) => ({
    at: m.ts,
    source: 'chat',
    actor: m.user,
    text: m.text.trim(),
  }));
}

const NOTE_LINE =
  /^\s*(?:[-*]\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|Z)\b)?\s*(?:[-:]\s+|\s+)(.+)$/;
const DAY_MS = 86_400_000;

/** Lines that start with a time. Times are UTC on the incident's opening date, rolling forward at midnight. */
export function parseNotes(markdown: string, openedAt: string): RawEvent[] {
  const day0 = Date.parse(openedAt.slice(0, 10));
  const events: RawEvent[] = [];
  let dayOffset = 0;
  let previous = -1;
  for (const line of markdown.split('\n')) {
    const m = NOTE_LINE.exec(line);
    if (!m) continue;
    const secondsOfDay = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
    if (secondsOfDay < previous) dayOffset += 1;
    previous = secondsOfDay;
    events.push({
      at: new Date(day0 + dayOffset * DAY_MS + secondsOfDay * 1000).toISOString(),
      source: 'notes',
      text: (m[4] as string).trim(),
    });
  }
  return events;
}

const Deploy = z.object({
  at: time,
  service: z.string().min(1),
  version: z.string().min(1),
  deployer: z.string().min(1).optional(),
  status: z.string().min(1).default('succeeded'),
});

export function parseDeploys(text: string): RawEvent[] {
  return parseJson('deploys.json', text, z.array(Deploy)).map((d) => ({
    at: d.at,
    source: 'deploy',
    ...(d.deployer ? { actor: d.deployer } : {}),
    text: `Deploy ${d.service} ${d.version} (${d.status})`,
  }));
}
