# Integration notes for the orchestrator

Piece 11 (rag-onboarding) touches only `pieces/11-rag-onboarding/**`, `.github/workflows/piece-11-rag-onboarding.yml`,
`docs/decisions/0012-python-for-rag-onboarding.md` and the `pnpm-lock.yaml` importer entry added by `pnpm install`.
Please add the following.

## Root README table row

`| 11 | [rag-onboarding](pieces/11-rag-onboarding) | Answers a new engineer's questions about the codebase and runbooks with file and line citations, and refuses when the sources are silent. Python. | Time to first merged PR; eval accuracy |`

## CHANGELOG bullet

`- rag-onboarding (piece 11): ChromaDB RAG agent with verbatim file:line citations, a deterministic refusal gate, an eval set graded in CI against a committed baseline, offline by default. First Python piece (ADR 0012).`

## Root package.json scripts

```json
"demo:11": "pnpm --filter @adl/rag-onboarding demo",
"demo:11:reset": "pnpm --filter @adl/rag-onboarding demo:reset"
```

The README and DEMO.md refer to `pnpm demo:11`, which works once these are added. The piece's own CI uses the `--filter` form.

## Root CI (`.github/workflows/ci.yml`)

The piece's `typecheck`, `test` and `coverage` scripts run through `scripts/uv.sh`. Where uv is not installed they print a
skip notice and exit 0, so `pnpm -r typecheck` and `pnpm -r coverage` pass. If you want the root job to run the Python
checks too, install uv there and set `RAG_REQUIRE_UV=1`, as `piece-11-rag-onboarding.yml` does. Add `pieces/11-rag-onboarding`
to any root path filters that matter.

## Other files

- `docs/sources.md`: no entry needed. The piece cites no statistic. `DEMO.md` says so.
- `docs/video-map.md`: row 11 status can move from planned to built.
- `eslint.config.js` already ignores `**/.venv/**`. Prettier needs no change: the piece keeps its tool caches under `.venv`.
- `.gitignore`: the piece has its own `.gitignore` (`.venv/`, `demo/out/`). Nothing to add at the root.

## Shared helper wishes

The Python `LlmClient`, fake, record and replay, Anthropic client and structured-output helper are local to the piece
(ADR 0012). If a second Python piece appears, extract `llm.py` and `structured.py` into `shared/py`.

## For the maintainer

- Run the "Verify before you deploy" commands in the README to try the ONNX embedder and a live model. Not run here.
- The committed LLM fixtures come from a scripted generator, not a model. Re-record with `uv run rag-onboarding fixtures --live`.
