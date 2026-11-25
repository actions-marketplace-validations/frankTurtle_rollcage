#!/usr/bin/env bash
# RAG onboarding demo. Usage: demo.sh [all|before|run|after|metric] [--live].
# Offline and deterministic by default. Needs uv; the first run installs Python packages.
set -eu
cd "$(dirname "$0")/.."
if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required (https://docs.astral.sh/uv/)" >&2
  exit 1
fi
ARGS=()
for arg in "$@"; do [ "$arg" = "--" ] || ARGS+=("$arg"); done
exec uv run --quiet python demo/demo.py ${ARGS[@]+"${ARGS[@]}"}
