import { z } from 'zod';
import type { AnalysisConfig } from '../types.ts';

const Env = z.object({
  DATA_SOURCE: z.string().optional(),
  TAG_KEY: z.string().trim().min(1).default('team'),
  MIN_DELTA_USD: z.coerce.number().nonnegative().default(25),
  MIN_DELTA_PCT: z.coerce.number().nonnegative().default(20),
  EXPECTED_CHANGES: z.string().default(''),
});

export interface LambdaConfig {
  /** 'live' only when DATA_SOURCE is exactly "live". The safe value is the default. */
  dataSource: 'fixture' | 'live';
  analysis: AnalysisConfig;
  tagKey: string;
}

export function loadConfig(env: Record<string, string | undefined>): LambdaConfig {
  const e = Env.parse(env);
  return {
    dataSource: e.DATA_SOURCE === 'live' ? 'live' : 'fixture',
    analysis: {
      minDeltaUsd: e.MIN_DELTA_USD,
      minDeltaPct: e.MIN_DELTA_PCT,
      expectedChanges: e.EXPECTED_CHANGES.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    tagKey: e.TAG_KEY,
  };
}
