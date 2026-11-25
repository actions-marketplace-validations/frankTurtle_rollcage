# 30-day pilot plan

Purpose: measure what one AI coding tool does to delivery in one team, using the five DORA
metrics that [piece 03](../03-dora-metrics/README.md) computes, before and after a fixed rollout
date.

This plan does not state what any tool does. It states what to measure and how to decide.

## Before day 0

Do these before the pilot starts. Once the pilot starts, the decision rule is fixed.

1. Pick one repository, one production environment, and one team. Piece 03 reads one repository
   and one environment per run.
2. Write down the rollout date (day 0). It is the `--compare-at` value for piece 03.
3. Write down the decision rule below in the pilot log, with the date. Do not change it later
   without writing down why.
4. Copy `dora.example.yml` from piece 03 to `dora.yml`. Set `min_samples: 10` for the pilot. This is
   this plan's choice, and no statistical threshold. Keep the other keys as the team's labels
   require: `incident_label`, `hotfix_labels`, `revert_title_prefix`.
5. Choose one deployment source, `deployments-api`, `releases` or `workflow-runs`, and use it for
   both windows. Do not switch sources in the middle.
6. Check the tool's audit export on a test account before day 0. This is the C1 gate in the
   rubric. If the export does not work, stop here.
7. Set a budget for the pilot's cost in the pilot log. D3 uses it.

## The five metrics (piece 03)

Piece 03's README has the full definitions. The names below are the ones its report uses.

| Metric                          | Better is | What it tells the pilot                                            |
| ------------------------------- | --------- | ------------------------------------------------------------------ |
| Deployment frequency            | higher    | Throughput: how often production changes.                          |
| Change lead time (median, p90)  | lower     | Throughput: how long a change takes to reach production.           |
| Change fail rate                | lower     | Instability: share of deployments followed by a revert, hotfix or incident. |
| Failed deployment recovery time | lower     | Instability: how long a failed deployment takes to recover from.   |
| Deployment rework rate          | lower     | Instability: share of deployments that are unplanned fixes.        |

Add one cost line from the tool's invoice: spend in the window divided by merged changes in the
window (D3).

Piece 03 counts a change as failed only when a revert, hotfix or incident is labelled or titled as
the config says. Check the labels in the first week. Unlabelled incidents do not count.

## The windows

- Before window: the 30 days ending the day before day 0.
- After window: the 30 days from day 0.

Piece 03 treats `--since` as inclusive and `--until` as exclusive, and `--compare-at` must fall inside
the range. For a rollout on 2026-04-06:

```bash
pnpm --filter @adl/dora-metrics exec tsx src/bin.ts report \
  --repo OWNER/NAME --config dora.yml \
  --since 2026-03-07 --until 2026-05-06 --compare-at 2026-04-06 \
  --out out/pilot
```

Write the output to `out/pilot`, and keep `dora.json` and `summary.md` with the pilot log.

If the tool reached people in stages, set day 0 to the day most of the team had it, and say so in
the log. A staged rollout blurs the split, and the pilot log has to say so.

## Sample size caveats

- `min_samples` is a floor. Piece 03 reports a metric with fewer data points as insufficient data,
  as a number. The plan sets 10 for this pilot, a choice made without a power calculation. This
  plan does not claim statistical significance for any result.
- A small team deploys few times in 30 days. Report the count of data points next to each metric,
  for both windows. Six deployments cannot show a trend in a median.
- One team and one repository give one before and one after. Nothing here is a control group. If
  another team with the same deployment process stays without the tool, run piece 03 on its
  repository for the same windows. That comparison is still observational, not a controlled
  experiment.
- Write down other changes in the pilot log: team changes, incidents, large releases, process
  changes, holidays. A before and after difference can come from any of them.
- Do not compare pilot numbers from one team with numbers from another team as if they were
  measured the same way.

## Decision rule (write it down before day 0)

Apply the rules in order. The first one that applies decides.

1. Gates. If the candidate scores 0 on a gate criterion (A1 or C1), stop. Do not pilot it.
2. Enough data. If either window has fewer than `min_samples` for deployment frequency or change
   lead time, the result is no decision yet. Extend the after window by 30 days once. If it is
   still short, the pilot could not measure the effect, and the log says so.
3. Expand only if all three hold:
   - Throughput is better, or flat, in the after window.
   - Change fail rate and deployment rework rate are flat or lower.
   - Cost per merged change (D3) is within the budget set before day 0.
4. Stop if change fail rate or rework rate rose with enough data, even if throughput rose. Faster
   delivery with more failures is the result this pilot is meant to catch.
5. Otherwise, hold. Extend the pilot or pick the next candidate from the scorecard. Do not stretch
   the rule to fit the numbers.

"Flat" and "rose" need a rule of their own. Write it down before day 0, with the change you would
call meaningful. This plan does not supply one.

## After day 30

1. Re-score the measured productivity criteria (E1 to E3) from the pilot numbers. Use the rubric's
   levels against the pilot numbers. Vendor claims do not count as pilot evidence.
2. Score your own scorecard with the script, which reads the same `weights.json`:

   ```bash
   pnpm --filter @adl/ai-dev-tool-eval exec tsx src/bin.ts score \
     --scorecard /path/to/your-scorecard.csv --weights weights.json
   ```
3. Apply the decision rule above. Record the decision, the date, and who made it.
4. Keep the pilot log, the piece 03 output, and the scorecard version together. The scorecard
   records the date each document was read, so a later reader can see how old the evidence is.

## Pilot log

One line per event, with a date: the rollout date, the labels you changed, the incidents, the
budget, the decision rule, and the decision. The log is the only record a reviewer needs to
reproduce the result.
