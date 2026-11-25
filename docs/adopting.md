# Adopting Rollcage in a real project

Short on time? `curl -fsSL https://raw.githubusercontent.com/frankTurtle/rollcage/main/init/rollcage-init.mjs | node -`
writes the proven pieces for you (see [SETUP.md](../SETUP.md)). The rest of this guide explains
what it wrote and why.

The demos show each piece alone. This guide turns the pieces on in the order a team would, using
[rollcage-example](https://github.com/frankTurtle/rollcage-example), a small orders service that
adopts the library. It covers sequencing and checks. Each piece's README has the install detail, so
this guide links to it instead of repeating it.

Before you start:

- The example's workflows have not been run against GitHub yet, and several live paths in the pieces
  are unproven (see [follow-ups.md](follow-ups.md)). Treat the "Check" lines as what to expect, and
  tell us when one differs.
- `protected_paths` (phase 0) is not in the `v0.2.0` tag. Use a ref that includes it, and pin to a
  commit SHA either way.
- Compliance mappings in the pieces are illustrative, not attestations.

## Start the baseline now (piece 03)

DORA needs weeks of history to mean anything, so set it up first and let it collect while you do
the rest. Schedule the [piece 03](../pieces/03-dora-metrics/README.md) action weekly
(`dora.example.yml` is the config) and set `compare-at` to the day you rolled out AI tools. Small
repos report "not enough samples" until they pass `min_samples`.

## Phase 0: rules before usage grows

**[Piece 02, agent policy](../pieces/02-agent-policy/README.md).** Fill in the policy, build the
hook, copy the hook and templates into `.claude/`, and add a CI job that runs
`agent-policy check --root .` (the example's `agent-policy.yml` workflow does this).

Set `protected_paths` so an agent cannot edit the guard's own config, hook, policy, check workflow
or CODEOWNERS. A human edits those. The example's list is in `.claude/agent-policy.yml`.

Check: pipe a synthetic Edit of `.claude/agent-policy.yml` into the hook
(`hook pre`). It exits 2 with rule `protected-path`. The block shows in the audit log.

**[Piece 04, secrets guard](../pieces/04-secrets-guard/README.md).** Layer 1 is the pre-commit hook
(`templates/pre-commit-config.yaml`, `gitleaks.toml` and the built `secrets-guard.mjs`). Layer 2 is
`templates/workflows/secrets-scan.yml`. Land the CI file with the phase 1 workflows if you want one
PR.

Check: stage a file with a fake AWS key and run `git commit`. The hook refuses before a commit
exists, so there is nothing to clean up.

## Phase 1: gate the pull request

Add these as one PR if you like. They are independent jobs.

- **[Piece 01, PR risk gate](../pieces/01-pr-risk-gate/README.md).** Copy `risk-gate.example.yml` to
  `risk-gate.yml`, start in `mode: observe`, and enforce once the scores look right. Pieces 05 and 06
  do not wait for that flip.
- **[Piece 05, SBOM and CVE triage](../pieces/05-sbom-vuln-triage/README.md).** Run it with
  `fail-on: critical`, and record accepted findings in a waivers file.
- **[Piece 06, policy gates](../pieces/06-policy-gates/README.md).** Run conftest on Terraform plan
  JSON and workflow YAML. The example keeps its Terraform in `infra/`; the path is up to you.

Check: the PR that adds these workflows touches `.github/workflows/`, so the risk comment on it
should score it above a docs-only change. For piece 06, run conftest locally on a plan with a
violation; the output names the control.

## Phase 2: trust what you deploy

**[Piece 10, provenance](../pieces/10-provenance-signing/README.md).** The gate verifies one file,
so ship the build as a tarball. Attest it in a manual workflow, then verify it with `signer-workflow`
set so only your build workflow satisfies the gate. Do not run it on pull requests: nothing is
attested yet, and attestation writes a public Sigstore entry on public repos. The example's
`provenance.yml` does both steps on `workflow_dispatch`.

## Later, as needed

- Operate: [07 CI failure triage](../pieces/07-ci-failure-triage/README.md),
  [08 AWS cost explainer](../pieces/08-aws-cost-explainer/README.md),
  [09 postmortem drafter](../pieces/09-postmortem-drafter/README.md).
- Enable: [11 RAG onboarding](../pieces/11-rag-onboarding/README.md) and
  [13 multi-agent workflow](../pieces/13-multi-agent-workflow/README.md), both optional.
- Choose tools: [14 tool eval](../pieces/14-ai-dev-tool-eval/README.md) is for deciding what to buy,
  so run it before you roll out a new tool, not after.

## Shortcut for a new repo

[Piece 12](../pieces/12-golden-path-template/README.md) scaffolds pieces 01, 04, 05, 06 and 10 into
a new repo. The example was started that way. Add phase 0's agent policy and the DORA workflow by
hand.
