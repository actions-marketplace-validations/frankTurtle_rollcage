# Demo script: 07 CI failure triage

Video: "Is it the code or the pipeline? Let AI triage your CI failures."

Run time: about 2 minutes, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:07:reset   # clean state before every take
pnpm demo:07         # the whole demo end to end
```

The demo uses fixture runs and logs written for this repo, and model replies recorded in
`demo/llm-fixtures` (hand-authored, not live output). Say so on camera. The numbers show how the
report reads, not a result. `DEMO_LIVE=1` with `ANTHROPIC_API_KEY` set uses a live model instead.

## 0:00 to 0:20, the problem

Say: "The build is red. Is it my code, a flaky test, or the pipeline?" Stat: 45% of developers say
debugging AI-generated code is more time-consuming (Stack Overflow 2025; `docs/sources.md`,
VERIFY). More generated code means more red builds to read.

## 0:20 to 1:00, why it matters

Every red build someone has to read costs attention. A re-run that happens to pass hides a flaky
test, so the same test fails again next week and the team learns to ignore red.

## 1:00 to 5:30, screen share

Before: the problem as it looks today.

```bash
pnpm demo:07 before
```

Prints the failed runs of the last two weeks as the Actions tab shows them: a workflow name, a
red status, and nothing about why.

Run: classify every failure.

```bash
pnpm demo:07 run
```

Prints one block per failed run: category, confidence, the error signature, the evidence lines,
and the summary and next step. Point at the four categories: a code regression, an infrastructure
failure (out of disk), a dependency failure (registry), and a flaky test. Point at the summary
source: `model` when the reply validated, `fallback` when it did not.

After: the quarantine proposal.

```bash
pnpm demo:07 after
```

Prints the proposal for the one test over the flaky thresholds: its flip rate, the patch to
`quarantine.json`, and the PR body. The tool wrote text only. A person applies the patch and opens
the pull request with the `gh` command printed underneath.

## 5:30 to 6:30, the metric

```bash
pnpm demo:07 metric
```

Prints time to green, flaky failure rate and reruns per week for the two periods either side of
the date, labeled as fixture data.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:07 run` from the first block to the flaky one, then the patch from
`pnpm demo:07 after`.

## Reset

`pnpm demo:07:reset` deletes `pieces/07-ci-failure-triage/demo/out`.
