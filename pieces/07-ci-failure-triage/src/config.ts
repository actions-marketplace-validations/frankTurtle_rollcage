import { parseYamlConfig } from '@adl/shared';
import { z } from 'zod';

const FlakySchema = z.object({
  /** Commits a test must have been observed on before its history can mark it flaky. */
  min_observations: z.number().int().min(1).default(10),
  /** Commits on which the test both failed and passed. */
  min_flip_commits: z.number().int().min(1).default(3),
  /** Flip commits divided by observed commits. */
  flip_rate_threshold: z.number().min(0).max(1).default(0.15),
});

const LogSchema = z.object({
  max_error_lines: z.number().int().min(1).max(10).default(3),
  excerpt_lines: z.number().int().min(1).max(50).default(12),
});

const ConfigSchema = z.object({
  flaky: FlakySchema.prefault({}),
  log: LogSchema.prefault({}),
  /** Metrics for a period with fewer failed runs than this are flagged as a small sample. */
  min_samples: z.number().int().min(1).default(5),
});

export type TriageConfig = z.infer<typeof ConfigSchema>;
export type FlakyConfig = TriageConfig['flaky'];

export const DEFAULT_CONFIG: TriageConfig = ConfigSchema.parse({});

export function loadConfig(yamlText?: string): TriageConfig {
  return parseYamlConfig(ConfigSchema, yamlText);
}
