import { z } from 'zod';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const WaiverSchema = z.object({
  id: z.string().min(1),
  package: z.string().min(1),
  reason: z.string().min(1),
  owner: z.string().min(1),
  expires: Day,
});

export type Waiver = z.infer<typeof WaiverSchema>;

export const parseWaivers = (json: unknown): Waiver[] =>
  z.object({ waivers: z.array(WaiverSchema) }).parse(json).waivers;
