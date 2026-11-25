import { z } from 'zod';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const EntrySchema = z.object({
  id: z.string(),
  package: z.string(),
  severity: z.string(),
  firstSeen: Day,
  resolvedAt: Day.optional(),
});

export type HistoryEntry = z.infer<typeof EntrySchema>;

export const parseHistory = (json: unknown): HistoryEntry[] =>
  z.object({ entries: z.array(EntrySchema) }).parse(json).entries;
