# Integration notes for piece 09 (for the orchestrator)

Files outside this piece that need a change. Nothing here was edited by the piece.

## Root README, pieces table row

| 09 | [Postmortem drafter](pieces/09-postmortem-drafter) | Postmortems get skipped because assembling the timeline by hand is slow, and pasting raw logs into an AI tool leaks secrets. | A blameless draft from logs, chat and deploys, with every sensitive value removed before the model call and a counts-only redaction report. | Time from incident close to published postmortem; share of incidents with a postmortem | backlog, built (draft) | (video link placeholder) |

Video hook: "Postmortem drafted before the bridge call ends."

## CHANGELOG bullet

- feat(postmortem-drafter): piece 09, a CLI that builds an incident timeline deterministically,
  redacts PII and secrets before any model call, and drafts a blameless postmortem with a
  deterministic fallback.

## Root package.json scripts

```json
"demo:09": "pnpm --filter @adl/postmortem-drafter demo",
"demo:09:reset": "pnpm --filter @adl/postmortem-drafter demo:reset"
```

`DEMO.md` and the README use `pnpm demo:09`, so these two scripts are needed. The piece's CI
workflow calls the filter form and does not depend on them.

## docs/sources.md

No new entry. The piece cites only the existing DORA entry (association between AI adoption and
delivery instability). `docs/video-map.md`: add piece 09 with the hook above and the demo commands
in `pieces/09-postmortem-drafter/DEMO.md`.

## Shared helpers wished for

- A reusable `Redactor` (placeholders, counts, Luhn) in `shared/ts`. Other pieces that send text to
  a model (01, 04, 11) could use it. The piece keeps a local copy in `src/redact.ts`.
- `parseJson(file, text, schema)` with file-named errors and the `UnavailableLlm` stand-in already
  exist in pieces 01 and here as local copies.
- `completeStructured` takes `ZodType<T>` with equal input and output types, so a schema with a
  `.transform` does not type-check. The piece maps the parsed value after the call instead.

## ADR

`docs/decisions/0010-postmortem-redaction-not-reversible.md` (reserved number 0010).
