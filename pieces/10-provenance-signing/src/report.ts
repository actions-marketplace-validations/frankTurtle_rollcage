import { z } from 'zod';

export const GateReportSchema = z
  .object({
    decision: z.enum(['allow', 'block']),
    total: z.number().int().min(0),
    verified: z.number().int().min(0),
    percent: z.number().min(0).max(100),
    results: z.array(
      z.object({
        artifact: z.string(),
        status: z.enum(['verified', 'failed']),
        reason: z.string(),
        sha256: z.string().optional(),
      }),
    ),
  })
  .refine((r) => r.verified <= r.total, { message: 'verified cannot exceed total' });

export type GateReport = z.infer<typeof GateReportSchema>;

export interface Metric {
  verified: number;
  total: number;
  percent: number;
}

export function percentOf(verified: number, total: number): number {
  return total === 0 ? 0 : Math.round((verified / total) * 100);
}

/** % of deployed artifacts signed and verified, summed over any number of gate reports. */
export function aggregateMetric(reports: readonly GateReport[]): Metric {
  const verified = reports.reduce((n, r) => n + r.verified, 0);
  const total = reports.reduce((n, r) => n + r.total, 0);
  return { verified, total, percent: percentOf(verified, total) };
}

export const renderMetric = (m: Metric): string =>
  `Signed and verified: ${m.verified} of ${m.total} deployed artifacts (${m.percent}%)`;
