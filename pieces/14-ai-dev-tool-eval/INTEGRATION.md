# Integration notes for piece 14 (for the orchestrator)

Piece 14 touched only its own folder, its CI workflow, `pnpm-lock.yaml` (one new importer for
`pieces/14-ai-dev-tool-eval`, zod already resolved), and `docs/decisions/0015-*.md`. The files below
belong to the orchestrator and were not edited here.

## Root README table row

| # | Piece | Problem | What it proves | Metric | Status | Video |
| - | ----- | ------- | -------------- | ------ | ------ | ----- |
| 14 | AI dev tool eval | Choosing and governing AI coding tools on evidence, not feature lists | A vendor-neutral rubric, a 30-day pilot with piece 03's metrics, and a scorecard with a deterministic gate-aware ranking | Weighted score (0 to 100); pilot before and after | MVP | placeholder |

Use the table's existing column order and status wording. Status "MVP" assumes the maintainer
accepts the piece; use "backlog" until then.

## CHANGELOG bullet

- Piece 14 (AI dev tool eval): vendor-neutral rubric, 30-day pilot plan that uses piece 03's
  metrics, placeholder scorecard, and a deterministic scoring and link-checking CLI.

## Root package.json scripts

```json
"demo:14": "pnpm --filter @adl/ai-dev-tool-eval demo",
"demo:14:reset": "pnpm --filter @adl/ai-dev-tool-eval demo:reset"
```

Place them after the `demo:04:reset` entry.

## docs/sources.md

No new entry is needed. The piece cites no statistic. PILOT.md names piece 03's five metrics, and
their definitions are already covered by the "DORA software delivery metrics (definitions)" section
(flagged VERIFY). Nothing about any AI coding tool vendor is stated anywhere in the piece.

## docs/video-map.md

Video title, from DEMO.md: "Copilot, Cursor, Claude Code: what to standardize on, and how to govern
it." Run time about 1 minute on screen.

## Shared helpers wished for

- A markdown link checker in `shared/ts/src`. Piece 14 has a local copy in `src/links.ts`
  (`extractLinks`, `headingSlugs`, `checkLinks`, with an injected fetcher for live mode). Other
  pieces that check their docs could reuse it. Move it when a second piece needs it.
- Nothing else. The CSV parser is a few lines and lives in `src/score.ts`.

## Notes

- CI workflow: `.github/workflows/piece-14-ai-dev-tool-eval.yml`, with the action SHAs copied from
  piece 03.
- The piece depends only on zod. It does not import `@adl/shared`.
- ADR 0015 (`docs/decisions/0015-ai-tool-eval-placeholder-vendors.md`) records the choice to store
  no vendor facts. Add it to any ADR index you keep.
