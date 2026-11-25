#!/usr/bin/env bash
# Offline demo for piece 14. Usage: demo.sh [all|score|links]. Deterministic, no network.
set -eu
cd "$(dirname "$0")/.."
STAGE="${1:-all}"

case "$STAGE" in
  all | score | links) ;;
  *)
    echo "usage: demo.sh [all|score|links]" >&2
    exit 2
    ;;
esac

header() { printf '\n== %s ==\n' "$1"; }

if [ "$STAGE" = "all" ] || [ "$STAGE" = "score" ]; then
  header "SCORE: weighted scores for PLACEHOLDER tools A, B and C"
  pnpm --silent exec tsx src/bin.ts score --out demo/out/scores.json
fi

if [ "$STAGE" = "all" ] || [ "$STAGE" = "links" ]; then
  header "LINKS: relative links in this piece's markdown (offline)"
  pnpm --silent exec tsx src/bin.ts links
fi
