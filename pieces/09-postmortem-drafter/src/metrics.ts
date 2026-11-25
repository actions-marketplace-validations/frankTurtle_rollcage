import { round1, summarize } from '@adl/shared';
import { z } from 'zod';

const when = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'not a valid time')
  .nullish();

const IncidentRecord = z
  .object({
    id: z.string().min(1),
    closed_at: when,
    postmortem_published_at: when,
  })
  .superRefine((r, ctx) => {
    if (!r.postmortem_published_at) return;
    if (!r.closed_at) {
      ctx.addIssue({ code: 'custom', message: 'has a postmortem but no closed_at' });
    } else if (Date.parse(r.postmortem_published_at) < Date.parse(r.closed_at)) {
      ctx.addIssue({ code: 'custom', message: 'postmortem published before the incident closed' });
    }
  });

export type IncidentRecord = z.infer<typeof IncidentRecord>;

export function parseIncidents(text: string): IncidentRecord[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('incidents.json: not valid JSON');
  }
  const records = z.array(z.unknown()).safeParse(json);
  if (!records.success) throw new Error('incidents.json: expected an array');
  return records.data.map((raw) => {
    const parsed = IncidentRecord.safeParse(raw);
    if (!parsed.success) {
      const id = (raw as { id?: unknown } | null)?.id;
      throw new Error(`incidents.json: incident ${String(id)}: ${parsed.error.issues[0]?.message}`);
    }
    return parsed.data;
  });
}

export interface PostmortemMetrics {
  closed: number;
  withPostmortem: number;
  pctWithPostmortem: number | null;
  hoursToPublish: { n: number; median: number | null; p90: number | null };
}

/** Open incidents are left out: a postmortem is not due until the incident closes. */
export function computeMetrics(incidents: IncidentRecord[]): PostmortemMetrics {
  const closed = incidents.filter((i) => i.closed_at);
  const published = closed.filter((i) => i.postmortem_published_at);
  const hours = published.map(
    (i) =>
      (Date.parse(i.postmortem_published_at as string) - Date.parse(i.closed_at as string)) /
      3_600_000,
  );
  return {
    closed: closed.length,
    withPostmortem: published.length,
    pctWithPostmortem: closed.length ? round1((published.length / closed.length) * 100) : null,
    hoursToPublish: { n: hours.length, ...summarize(hours) },
  };
}
