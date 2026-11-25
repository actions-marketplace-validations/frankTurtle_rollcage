# 0012. Python for piece 11, and what happens to shared/py

Status: accepted, pending maintainer review. Follows [ADR 0004](0004-python-shared-deferred.md).

Piece 11 (RAG onboarding) is the first Python piece. The vector store (ChromaDB), its bundled
ONNX embedder and pydantic are Python-first, and the maintainer's MatterBrief project, whose
citation and refusal patterns this piece reuses, is Python. Everything else in the repo stays
TypeScript.

ADR 0004 said `shared/py` would be created with piece 11, mirroring the TypeScript interfaces. It
is not created. Piece 11 is the only Python consumer, and a shared package with one consumer is
the speculation ADR 0004 set out to avoid. The shared-like code lives inside the piece instead:
`llm.py` (the `LlmClient` interface, a scripted fake, record and replay, and an Anthropic client
over plain HTTP, mirroring `shared/ts/src/{llm,fake-llm,replay,anthropic,config}.ts`) and
`structured.py` (JSON, pydantic validation, one retry, then a deterministic fallback, mirroring
`structured.ts`). A second Python piece is the signal to extract them into `shared/py`.

ADR 0004 also said `shared/py` would mirror the audit log line format so one verifier reads
both. Piece 11 does not write an audit log. If a later change makes it write one, extract the
log to `shared/py` at that point.

Tooling choices:

- `uv` manages the environment and `uv.lock` is committed. `requires-python` is `>=3.12`. No
  interpreter is downloaded by the project.
- `ruff` for lint and format, `mypy --strict`, and `pytest` with `pytest-cov` and a 90 percent
  line floor. The Node lint and prettier rules do not apply to `.py` files.
- A small `package.json` (`@adl/rag-onboarding`, private) wraps the uv commands so the root pnpm
  scripts reach the piece. `scripts/uv.sh` skips with a notice when uv is not installed, so
  `pnpm -r typecheck` and `pnpm -r coverage` still pass on a machine without uv. The piece's CI
  sets `RAG_REQUIRE_UV=1`, which turns that skip into a failure.
- The Anthropic call uses the standard library (`urllib`), for the same reasons as ADR 0002.
- Tests and the default demo download nothing. Embeddings sit behind an `Embedder` interface. The
  default is a hashed bag of words and the ONNX model is opt-in with `--live`.
