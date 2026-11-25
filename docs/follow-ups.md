# Follow-ups from the pieces 05 to 14 build

Collected from each piece's integration notes. Nothing here blocks the demos.

## Needs the maintainer's OK

- Piece 10: enabling the `attest-sample` job or running the action in `attest` mode writes a public
  Rekor transparency log entry that includes the repo identity.
- Piece 10: re-check the pinned SHAs for `actions/attest-build-provenance` (v4.2.2) and
  `sigstore/cosign-installer` (v4.1.4); they were read with `git ls-remote`.
- Piece 08: deploying the SAM app (`DEPLOY.md` has the command, tags and teardown). Cost Explorer
  API calls are billed per request.
- Piece 14: the rubric levels and default weights are drafts.

## Not yet proven against the real service

- Piece 05: Grype JSON fixtures are hand-authored in Grype's shape; KEV and EPSS live response
  shapes are unchecked; syft and grype were not run end to end through the action.
- Piece 06: the Terraform plan fixtures were not produced by a Terraform run.
- Piece 07: the live GitHub path (log redirects, `updated_at` as finish time).
- Piece 08: Cost Explorer request shapes come from SDK types; whether `ce:*` can be scoped below `*`.
- Piece 10: the `gh attestation verify --format json` output shape.
- Piece 11: the ONNX embedder and live Anthropic paths; eval accuracy is 77.3% against scripted
  model responses, which is the committed baseline.
- Piece 12: `pnpm install` on a generated project; the branch-protection `gh api` command.
- Piece 13: `--live` mode; the committer is a dry run.
- Every piece: recorded model responses are scripted stand-ins, not real model output.

## Candidates for `shared/ts`

Done: `selectLlm` / `UnavailableLlm` / `parseLlmMode`, `unifiedDiff`, the markdown link checker,
`daysBetween` (piece 05), and `completeStructured` now rejects `.transform` schemas.

Skipped, with the reason:

- A command runner with an injectable exec (pieces 05, 06, 10). The three copies differ in
  behavior: 05 uses `spawn` and returns `status` (null on a signal) but rejects when the program
  cannot start; 06 uses `execFile`, returns `code`, rejects on a missing program and callers read
  `error.code === 'ENOENT'`; 10 never throws, returns `code: null` plus an `error` string, and adds
  a timeout and extra env. Unifying them would change error handling in two pieces.
- A redactor (pieces 07, 09). They are not the same function. Piece 09's `Redactor` is stable
  per-value placeholders, a report, `assertClean`, and covers JWT, email, card (Luhn), IPs and
  phone; piece 07's `redact` uses fixed markers and a smaller pattern set. Sharing one would change
  piece 07's output, and moving 07 onto 09's is a behavior change to review on its own.
- `memo` and a `must()` test helper (08); piece 08 was left alone, including its private
  `daysBetween`, which is identical to the shared one and can switch in a later change.

## Escapement 0.2.0 gaps found by piece 13

1. No multi-agent topology: one `run()` is one agent, so the piece chains four runs.
2. No suspended or approval phase; the human checkpoint lives outside the state machine.
3. `replay(ledger)` replays the reducer only, not tools or the model.
4. No `caseFromLedger(ledger, graders)` for building eval cases from recorded runs.
5. `scriptedProvider` generates its own tool call ids, so it cannot reproduce another provider's
   ledger byte for byte.
6. Tool handlers need casts on `args`; a schema-typed `tool()` overload would help.
7. `ModelProvider` assumes native tool calls; text-only clients need a JSON turn format.
