# Integration notes for the orchestrator

Piece 06, `@adl/policy-gates`, branch `feature/06-policy-gates`.

## Root README table row

| 06 | [Policy gates](pieces/06-policy-gates) | OPA/Rego rules run with conftest on Terraform plan JSON and workflow YAML, with illustrative NIST SP 800-171 control IDs in every violation. Composite GitHub Action. | `pnpm demo:06` |

Match the column layout of the existing rows.

## CHANGELOG bullet

- Add piece 06 policy gates: six Rego rules (public S3, encryption at rest, wildcard IAM, unpinned
  actions, workflow permissions, static cloud keys), an illustrative NIST SP 800-171 mapping, a
  conftest CLI wrapper with an optional model explanation, and a composite GitHub Action.

## Root package.json scripts

```json
"demo:06": "pnpm --filter @adl/policy-gates demo",
"demo:06:reset": "pnpm --filter @adl/policy-gates demo:reset"
```

## docs/sources.md

No new entry. No statistic is cited. The demo script points to the existing DORA 2025 entry
(association of AI adoption with delivery instability). The unverified GitLab statistic is not
used anywhere in this piece. The video hook is left to the orchestrator.

## Contract for piece 12

`pieces/06-policy-gates/action.yml` is a composite action with inputs `path` (default `.`, space
separated files or directories) and `policy` (default empty, meaning the bundled policies). It
fails the job on any violation. Pin it by commit SHA when calling it.

## Repo self-gating

The root repository could run the action on its own `.github/workflows` once the orchestrator
wants it:

```yaml
- uses: ./pieces/06-policy-gates
  with:
    path: .github/workflows
```

Note that `check` skips `node_modules` and `.git` by default. Root CI workflows that lack a
`permissions` block or use unpinned actions would fail, which is the point.

## Shared helpers I wished existed

- A shared "run a CLI with an injectable exec function" helper (`ExecFn` in
  `src/conftest.ts`) would help pieces that shell out to gitleaks, syft, grype and cosign.
- A shared tool-install step for CI (conftest, opa) with checksum verification. Both the piece
  workflow and the action carry a copy of the install commands.

## Needs a person to verify

- The CI and action download URLs and checksum file names for conftest and opa are from memory of
  the release layout and were not fetched. Run the workflow once on a branch.
- The `aws-actions/configure-aws-credentials` SHA in `examples/workflows/deploy-fixed.yml` is a
  placeholder, labeled as an example pin in the file.
- Plan JSON fixtures are hand-written, not produced by `terraform show -json`.
