import type { LlmClient } from '@adl/shared';
import { fixtureCostPort } from '../adapters.ts';
import { FIXTURE_NOW } from '../fixture-data.ts';
import { runReport } from '../report.ts';
import type { Delivery } from '../report.ts';
import type { CostPort, NotifyPort } from '../types.ts';
import type { LambdaConfig } from './config.ts';

export interface HandlerDeps {
  config: LambdaConfig;
  /** Built only in live mode, so fixture mode never creates a Cost Explorer client. */
  liveCost(): CostPort;
  now(): Date;
  llm(): Promise<LlmClient | undefined>;
  channels(): Promise<NotifyPort[]>;
}

export interface HandlerResult {
  dataSource: 'fixture' | 'live';
  summarySource: 'model' | 'fallback';
  reason?: string;
  unexplainedUsd: number;
  anomalies: number;
  deliveries: Delivery[];
}

/** The scheduled entry point. Fixture mode runs on the bundled fixture and its fixed report date. */
export function createHandler(deps: HandlerDeps) {
  return async (): Promise<HandlerResult> => {
    const { config } = deps;
    const live = config.dataSource === 'live';
    const llm = await deps.llm();
    const report = await runReport({
      now: live ? deps.now() : FIXTURE_NOW,
      config: config.analysis,
      tagKey: config.tagKey,
      cost: live ? deps.liveCost() : fixtureCostPort(),
      ...(llm ? { llm } : {}),
      channels: await deps.channels(),
    });
    return {
      dataSource: config.dataSource,
      summarySource: report.summary.source,
      ...(report.summary.reason === undefined ? {} : { reason: report.summary.reason }),
      unexplainedUsd: report.analysis.unexplained.amount,
      anomalies: report.analysis.anomalies.length,
      deliveries: report.deliveries,
    };
  };
}
