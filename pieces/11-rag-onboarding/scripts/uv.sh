#!/usr/bin/env bash
# Run `uv <args>` inside this piece. The pnpm scripts call this so that `pnpm -r typecheck` and
# `pnpm -r coverage` keep working on a machine without uv: the Python checks are skipped with a
# notice. Set RAG_REQUIRE_UV=1 (this piece's CI does) to fail instead of skipping.
set -eu
cd "$(dirname "$0")/.."
if ! command -v uv >/dev/null 2>&1; then
  if [ "${RAG_REQUIRE_UV:-}" = "1" ]; then
    echo "error: uv is required (https://docs.astral.sh/uv/)" >&2
    exit 1
  fi
  echo "skipped: uv is not installed, so the Python checks for 11-rag-onboarding did not run"
  exit 0
fi
exec uv "$@"
