# Follow-ups from the pieces 05 to 14 build

Collected from each piece's integration notes. Nothing here blocks the demos.

## Needs the maintainer

- Piece 14: the rubric levels and default weights are drafts.
- AWS: three demo stacks run in us-east-1 (`rollcage-secrets-guard`, its canary, and
  `rollcage-aws-cost-explainer` in fixture mode). A reminder to tear them down is set for
  2026-12-28. The deploy profile is the account root user; a scoped deploy role would be safer.

## Closed on 2026-11-25

- Piece 10: the attestation job is enabled for manual runs (`workflow_dispatch`); the pinned SHAs
  for `actions/attest-build-provenance` v4.2.2 and `sigstore/cosign-installer` v4.1.4 match the
  tags; the SLSA level claims match slsa.dev and GitHub's docs.
- Piece 10: first manual attestation run on rollcage-example `main` succeeded (Rekor log index
  4113226122) and the deploy gate verified it, 1 of 1 artifacts, so the `gh attestation verify
  --format json` shape matches what the piece parses. The raw JSON was not captured as a fixture.
- Piece 08: deployed and invoked once in fixture mode.
- Piece 05: the KEV and EPSS parsers are pinned to real responses captured on 2026-11-25.
- Piece 02: the guard now blocks agents from editing its own config and source
  (`protected_paths`).

## Proven live on 2026-11-25

See [live-proof-report.md](live-proof-report.md) for commands and results. Pieces 05, 06, 07, 09,
11, 12 and 13 were run against the real tools and the real model; their fixtures now come from
real output where the format allows (Grype, syft, Terraform plans, a GitHub job log, piece 11's
model responses). Fixes found by doing so: piece 06 PG002 matches an encryption resource by
reference, piece 05 and 08 token limits, piece 07 byte order mark, piece 12 template formatting.

## Not yet proven against the real service

- Piece 05: the composite action on a GitHub runner (the tools and the command it runs were
  proven locally).
- Piece 08: live mode with Cost Explorer (no scoped read-only profile); request shapes come from
  SDK types; whether `ce:*` can be scoped below `*`.
- Piece 13: `approve` and `commit` after a live run; the committer is a dry run.
- Pieces 05, 06, 08, 09, 13: recorded model responses other than piece 11's are still scripted
  stand-ins. Live runs worked; the fixture formats there were not re-recorded.
- Escapement: the model's JSON turn format is fragile (1 of 3 live runs halted on repair turns).

## Candidates for `shared/ts`

Done: `selectLlm` / `UnavailableLlm` / `parseLlmMode`, `unifiedDiff`, the markdown link checker,
`daysBetween` (pieces 05 and 08), and `completeStructured` now rejects `.transform` schemas. Piece
08's `memo` was removed rather than shared.

Skipped, with the reason:

- A `must()` test helper (08); it is a test-only one-liner.

Done afterwards, as reviewed behavior changes:

- Command runner: `execRunner` in `shared/ts` has the shape piece 10 had: it never throws, returns
  `code: null` plus `error` and `errorCode` when a program cannot start, and takes a timeout and
  extra env. With `throwOnStartError` it rejects instead, with the Node error (`code === 'ENOENT'`),
  which is what pieces 05 and 06 relied on. The default is no timeout; piece 10 passes 60 s.
  Piece 10's own wrapper is gone and its callers use the shared function. Change: piece 05 now
  collects output through `execFile` with a 64 MB limit instead of streaming through `spawn`.
  Piece 12's runner is synchronous and stays local.
- Redactor: piece 09's `Redactor` moved to `shared/ts` and gained Slack token and `sk-` API key
  rules, plus `types` and `format` options. Piece 07 uses `redactSecrets`, which applies only the
  secret rules. Changes to piece 07 output: every marker is `[REDACTED:<type>]` (the AWS key type
  is `aws-access-key`, not `aws-key`; bearer tokens and `NAME=value` secrets no longer keep
  `Bearer [REDACTED]` or `NAME=[REDACTED]`, the name stays and the value is replaced); a bearer
  token must contain a digit or symbol to match; and a credential value ends at whitespace, a
  quote, a comma or a semicolon.

## Escapement gaps found by piece 13

Seven gaps were logged against Escapement 0.2.0. Version 0.3.0 closes all seven in the library, and
piece 13 now runs on it. Six are adopted; one is available but deliberately not used.

1. No multi-agent topology. Closed by `pipeline()` (ADR-0020). The workflow runs as a pipeline.
2. No suspended or approval phase. Closed by `requiresApproval` and `resume()` (ADR-0019), **not
   adopted**: the piece's gate approves a change hash for the orchestrator's commit, and agents hold
   no commit tool, so there is no model-issued call to suspend on.
3. `replay(ledger)` replays the reducer only. Closed by `reexecute`, `replayProvider` and
   `recordedTools` (ADR-0018). Piece 13 uses `replayProvider`; its own workflow-level re-execution
   stays because the routing code is the piece's.
4. No `caseFromLedger`. Closed (ADR-0018); the evals use it.
5. `scriptedProvider` generated its own call ids. Closed: ledger-derived scripts keep recorded ids.
6. Tool handlers needed casts on `args`. Closed by `defineTool` (ADR-0021); the casts are gone.
7. `ModelProvider` assumed native tool calls. Closed by `textProvider` (ADR-0022); the piece's own
   JSON turn protocol and retry are gone. A malformed reply is now repaired inside the run and
   counts against `max_steps`, not retried once outside it.

