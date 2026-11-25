import { z } from 'zod';

/** One rubric criterion, as the scoring code sees it. */
export interface Criterion {
  id: string;
  group: string;
  name: string;
  weight: number;
  /** A gate criterion that scores 0 blocks the tool from ranking above any unblocked tool. */
  gate: boolean;
}

const CriterionSchema = z.object({
  id: z.string().regex(/^[A-Z]\d+$/, 'id must look like A1'),
  group: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().finite().positive(),
  gate: z.boolean(),
});

export const WeightsFileSchema = z
  .object({
    version: z.literal(1),
    criteria: z.array(CriterionSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.criteria.forEach((criterion, index) => {
      if (seen.has(criterion.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['criteria', index, 'id'],
          message: `duplicate criterion id ${criterion.id}`,
        });
      }
      seen.add(criterion.id);
    });
  });

export class WeightsError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`weights file is invalid:\n  ${errors.join('\n  ')}`);
    this.name = 'WeightsError';
    this.errors = errors;
  }
}

/** Validates the parsed JSON of weights.json and returns its criteria in file order. */
export function parseWeights(json: unknown): Criterion[] {
  const result = WeightsFileSchema.safeParse(json);
  if (!result.success) {
    throw new WeightsError(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`),
    );
  }
  return result.data.criteria;
}
