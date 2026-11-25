# Adopting Rollcage in a real project

The demos show each piece alone. This guide shows them together, in the order a team would turn
them on, using [rollcage-example](https://github.com/frankTurtle/rollcage-example), a small orders
service that adopts the library.

Read the phases in order. Each one is small enough to land as one pull request and has a check that
tells you it worked. Compliance mappings are illustrative, not attestations.

## Shortcut for a new repo

Piece 12 scaffolds phases 1 and 2 (risk gate, secrets scan, SBOM triage, policy gates, provenance
verify) into a new repo:

```bash
pnpm --filter @adl/golden-path-template scaffold ~/code/my-service --name my-service --owner my-org --ref <sha>
```

rollcage-example was started that way. It then added the agent policy (phase 0) and DORA (phase 3).
For an existing repo, follow the phases below.

## Phase 0: rules before usage grows

**Piece 02, agent policy.** Copy `policy/AI_CODING_AGENT_POLICY.md` and fill in the placeholders.
Build the hook (`pnpm --filter @adl/agent-policy build`) and copy `dist/agent-policy-hook.mjs`,
`templates/settings.json` and `templates/agent-policy.yml` into `.claude/`. Add a CI job that runs
`agent-policy check --root .` (see `.github/workflows/agent-policy.yml` in the example).

Set `protected_paths` so an agent cannot edit the guard's own config, hook or policy. In the
example the list covers `.claude/settings.json`, `.claude/agent-policy.yml`, `.claude/hooks/**`,
the policy file, the check workflow and CODEOWNERS. A human edits those.

Check: ask an agent to edit `.claude/agent-policy.yml`. It is blocked with rule `protected-path`
and the block lands in the audit log.

**Piece 04, secrets guard.** Install the pre-commit hook and call the secrets-scan workflow in CI.
Check: commit a fake AWS key locally and see the commit refused.

## Phase 1: gate the pull request

**Piece 01, PR risk gate.** Add `risk-gate.yml` with `mode: observe` and call the gate workflow on
`pull_request`. Run for a week, read the comments, tune weights, then switch to `enforce`.

**Piece 05, SBOM and CVE triage.** Run it on every PR with `fail-on: critical`. The job fails only
for unresolved findings that are in KEV or above the EPSS threshold, so it blocks real risk and not
noise. Use a waivers file for accepted findings, with an end date.

**Piece 06, policy gates.** Keep Terraform in `infra/` and run conftest against the plan JSON and the
workflow files. The example's bucket module sets encryption, public access block and tags so it
passes; remove one and the job names the violated control.

Check: open a PR that touches `.github/workflows/` and see the risk comment score it higher than a
docs change.

## Phase 2: trust what you deploy

**Piece 10, provenance.** Build the artifact once, attest it in a manual or release workflow, and
make the deploy job run the `verify` mode with `signer-workflow` set. Attestation writes a public
Sigstore entry on public repos, so it runs only when started by hand. The example's current
`provenance.yml` verifies a build output; attesting a release tarball is the next step there.

## Phase 3: show whether it pays off

**Piece 03, DORA metrics.** Add `dora.yml` and the weekly workflow with `compare-at` set to the date
you rolled out AI tools. Report the five metrics before and after. Expect "not enough samples" for
small repos; the config has a `min_samples` floor.

## Phase 4: operate it (not yet wired in the example)

- 07 CI failure triage on failed runs; 08 cost explainer on a schedule; 09 postmortem drafter after
  incidents, with redaction on.
- 11 RAG onboarding over your own docs and runbooks; 13 multi-agent workflow for changes that need
  a replayable trace; 14 tool eval before you buy a new AI tool.

## What is not proven

Several live paths are unproven; see [follow-ups.md](follow-ups.md). In particular the example's
workflows have not been run against GitHub yet, and recorded model responses in the pieces are
scripted stand-ins.
