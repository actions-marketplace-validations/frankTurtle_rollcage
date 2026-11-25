# 0007: Conftest decides, rule IDs live in the Rego messages, the mapping lives in JSON

Status: accepted

## Context

Piece 06 runs OPA/Rego policies under conftest and prints each violation with NIST SP 800-171
control IDs. The control mapping is something a compliance lead should be able to review and edit
without reading Rego, and it must carry a label saying it is not an attestation. A model may help
explain a violation, and the model must not affect pass or fail.

## Decision

- Each Rego `deny` message starts with a rule ID and a colon (`PG003: ...`). The TypeScript CLI
  reads the ID from conftest's JSON output and looks the controls up in `policies/controls.json`.
  Conftest's own metadata support is not used, so plain `conftest test` still prints useful
  messages without the CLI.
- The mapping is a separate JSON file validated with zod. Its `label` field must equal
  "illustrative mapping, not a compliance attestation", and a test fails if a rule ID in the Rego
  has no entry.
- The exit code comes from conftest's failures only. The explanation step runs after the decision,
  uses the shared structured-output helper, and falls back to the mapping's remediation text.
- Rules are checked against plan JSON by literal values. Values unknown until apply are skipped,
  which is stated in the README limits.
- Rego coverage is enforced with `opa test --coverage --threshold`.

## Consequences

- Adding a rule means a Rego file, a test file and a mapping entry. Forgetting the entry fails CI.
- A rule whose message lacks an ID still fails the gate, and is reported as UNKNOWN with no
  controls, so a gap in the mapping cannot hide a violation.
- The recorded model responses in the demo are hand-written stand-ins in the record/replay format.
  Re-record with `DEMO_LIVE=1` to replace them.
