import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const MAPPING_LABEL = 'illustrative mapping, not a compliance attestation';

const mappingSchema = z.object({
  label: z.literal(MAPPING_LABEL),
  standard: z.string().min(1),
  rules: z.record(
    z.object({
      title: z.string().min(1),
      controls: z
        .array(
          z.string().regex(/^3\.\d{1,2}\.\d{1,2}$/, 'expected a NIST SP 800-171 ID like 3.1.5'),
        )
        .min(1),
      remediation: z.string().min(1),
    }),
  ),
});

export type Mapping = z.infer<typeof mappingSchema>;

export function loadMapping(path: string): Mapping {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read the controls mapping file at ${path}`);
  }
  return mappingSchema.parse(JSON.parse(text));
}
