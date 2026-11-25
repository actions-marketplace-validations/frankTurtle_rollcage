# Integration notes for the orchestrator

Files outside this piece that need an edit. Nothing here was changed by the piece branch.

## Root README table row

| 08 | AWS cost explainer | AWS bills are read monthly, so a runaway resource bills for weeks | A weekly job computes week-over-week deltas by service and tag in code and a model explains them in plain English; invalid or ungrounded model output falls back to a deterministic summary | Unexplained spend; time to notice an anomaly | MVP/backlog: done (draft, not deployed) | video: placeholder |

Adjust the columns to match the table's current header.

## CHANGELOG bullet

- feat(aws-cost-explainer): weekly AWS cost explainer SAM app (EventBridge, Lambda, Cost Explorer and Cost Anomaly Detection, SNS or Slack). Fixture mode by default, live mode read-only and opt-in.

## Root package.json scripts

```json
"demo:08": "pnpm --filter @adl/aws-cost-explainer demo",
"demo:08:reset": "pnpm --filter @adl/aws-cost-explainer demo:reset"
```

DEMO.md uses `pnpm demo:08 before|run|after|metric`; this works once the scripts above exist.

## docs/sources.md

No statistics are cited. Optional entry for the AWS pages to read before deploying (not read in
this session, so no facts are claimed from them):

- Cost Explorer pricing: https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/
- `GetCostAndUsage` and `GetAnomalies` API references.

## docs/video-map.md

08 | "Your AWS bill explained in plain English, every Monday." | pieces/08-aws-cost-explainer/DEMO.md

## Shared helpers I wished existed

- `lazy` and `remember` (memoize a client, memoize an async load but not a failure) live in
  piece 04 (`src/lambda/memo.ts`); this piece keeps its own copy. They belong in `shared/ts`.
- A `must(value)` test helper (narrow `T | undefined` without a non-null assertion) is copied into
  `tests/helpers.ts`; the lint rule forbids `!`.
- An `AnthropicLlm` that takes its key and model from a plain object is already supported; nothing
  needed.
