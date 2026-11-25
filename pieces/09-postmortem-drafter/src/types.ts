import { z } from 'zod';

export type Source = 'deploy' | 'log' | 'chat' | 'notes';

/** Order used to break ties between events at the same instant. */
export const SOURCE_ORDER: Source[] = ['deploy', 'log', 'chat', 'notes'];

/** One thing that happened, before sorting. `at` is an ISO 8601 UTC string with milliseconds. */
export interface RawEvent {
  at: string;
  source: Source;
  actor?: string;
  text: string;
}

export interface TimelineEvent extends RawEvent {
  id: string;
}

const isoTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'not a valid time');

export const IncidentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  severity: z.string().min(1),
  opened_at: isoTime,
  closed_at: isoTime,
});
export type Incident = z.infer<typeof IncidentSchema>;

export interface Bundle {
  incident: Incident;
  events: RawEvent[];
}
