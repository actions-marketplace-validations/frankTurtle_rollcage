#!/usr/bin/env bash
# Unit-test the Rego rules, then fail below the coverage threshold. Needs `opa` on PATH.
set -eu
cd "$(dirname "$0")/.."
THRESHOLD=95
opa test policies --verbose | tail -n 3
report="$(mktemp)"
trap 'rm -f "$report"' EXIT
status=0
opa test policies --coverage --threshold "$THRESHOLD" --format json >"$report" || status=$?
node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log(`rego coverage: ${r.coverage}% (floor ${process.argv[2]}%)`);' "$report" "$THRESHOLD"
exit "$status"
