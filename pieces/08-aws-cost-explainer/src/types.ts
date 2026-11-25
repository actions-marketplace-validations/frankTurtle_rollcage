/** What Cost Explorer reports for spend with no value for the cost allocation tag. */
export const UNTAGGED = '(untagged)';

/** Dates are YYYY-MM-DD (UTC). `end` is exclusive, as in the Cost Explorer API. */
export interface DateRange {
  start: string;
  end: string;
}

export interface CostRow {
  key: string;
  amount: number;
}

export interface Anomaly {
  id: string;
  service: string;
  startDate: string;
  totalImpact: number;
  /** Short, human-readable root cause fields from Cost Anomaly Detection. */
  rootCauses: string[];
}

export type Grouping = { type: 'SERVICE' } | { type: 'TAG'; key: string };

/** Read-only cost data. The real version calls Cost Explorer; tests and the demo use fixtures. */
export interface CostPort {
  costByGroup(range: DateRange, grouping: Grouping): Promise<CostRow[]>;
  anomalies(range: DateRange): Promise<Anomaly[]>;
}

export interface NotifyPort {
  name: string;
  send(subject: string, text: string): Promise<void>;
}

export interface AnalysisConfig {
  /** A change is material only if its absolute size is at least this many dollars. */
  minDeltaUsd: number;
  /** ... and its size relative to the previous week is at least this percent (new spend exempt). */
  minDeltaPct: number;
  /** Services whose increase someone has said to expect. */
  expectedChanges: string[];
}
