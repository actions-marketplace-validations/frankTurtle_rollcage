#!/usr/bin/env bash
# AWS cost explainer demo. Usage: demo.sh [all|before|run|after|metric]. Offline and deterministic.
# Nothing touches AWS or Slack. DEMO_LIVE=1 adds a live model call (needs ANTHROPIC_API_KEY).
set -u
cd "$(dirname "$0")/.."
STAGE="all"
for arg in "$@"; do [ "$arg" = "--" ] || STAGE="$arg"; done
exec pnpm --silent exec tsx demo/demo.ts "$STAGE"
