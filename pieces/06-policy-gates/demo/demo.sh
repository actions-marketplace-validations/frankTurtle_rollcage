#!/usr/bin/env bash
# Policy gates demo. Usage: demo.sh [all|before|run|after|metric]. Offline and deterministic.
# Needs conftest on PATH. Set DEMO_LIVE=1 to get the explanations from the live API.
set -u
cd "$(dirname "$0")/.."
STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done
command -v conftest >/dev/null || { echo "conftest is not on PATH: https://www.conftest.dev/install/" >&2; exit 2; }
exec pnpm --silent exec tsx demo/demo.ts "$STAGE"
