# Integration notes for the orchestrator (piece 07, CI failure triage)

Files outside the piece folder that the orchestrator should edit. Nothing here was edited by the
piece branch, apart from the workflow and ADR listed at the end.

## Root README table row

| 07 | CI failure triage | A red build is ambiguous: code, flaky test, pipeline or dependency? | Classifies failed runs with rules and run history, drafts a quarantine proposal for flaky tests (never opens the PR) | Time to green, flaky failure rate, reruns per week | done | video: "Is it the code or the pipeline? Let AI triage your CI failures." (link placeholder) |

Use the table's own column order; the cells above are the content.

## CHANGELOG bullet (Unreleased, Added)

- 07 CI failure triage: reads failed workflow runs (GitHub API or local logs), extracts a normalized
  error signature, classifies each as regression, flaky, infrastructure or dependency with evidence,
  writes a summary with a deterministic fallback, keeps a flip-rate history, and drafts a quarantine
  patch and PR body for human review. Reports time to green, flaky failure rate and reruns per week.

## Root package.json scripts

```json
"demo:07": "pnpm --filter @adl/ci-failure-triage demo",
"demo:07:reset": "pnpm --filter @adl/ci-failure-triage demo:reset"
```

## docs/sources.md

No new entry. DEMO.md cites the existing Stack Overflow 2025 item (45% say debugging AI-generated
code is more time-consuming), flagged VERIFY there.

## docs/video-map.md

Add a row for piece 07 with the video title above and the demo command `pnpm demo:07`.

## Shared helpers wished for

- `selectLlm`, `parseLlmMode` and `UnavailableLlm` (`src/llm-select.ts`) are copied from piece 01.
  They belong in `shared/ts`.
- `unifiedDiff` (`src/quarantine.ts`) could be shared with any piece that proposes a file change.
- `redact` (`src/redact.ts`) is a small pattern-based secret redactor. Piece 04 has its own
  detector; a shared one would avoid two lists of token shapes.

## Files added outside the piece folder

- `.github/workflows/piece-07-ci-failure-triage.yml`
- `docs/decisions/0008-flip-rate-definition-and-no-pr-creation.md`
- `pnpm-lock.yaml` (the new workspace package entry from `pnpm install`)
