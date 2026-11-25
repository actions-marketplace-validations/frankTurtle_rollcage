# 06 Policy gates

Policy as code for infrastructure and CI. OPA/Rego rules run under `conftest` against Terraform
plan JSON and GitHub workflow YAML. A small TypeScript CLI runs conftest, reads its JSON output
and prints each violation with the NIST SP 800-171 control IDs it relates to. It ships as a
composite GitHub Action that fails the job on any violation.

## For engineering leaders

**The problem.** Compliance gaps are expensive to fix once a system is running, and AI-assisted
changes arrive faster than a person can review each one for them. A public bucket or a
wildcard IAM policy is easy to describe in a rule and slow to find by reading a diff.

**What this proves.**

- Six starter rules turn written policy into a check that runs on every pull request: no public
  S3 buckets, encryption at rest, no wildcard IAM actions or resources, actions pinned by commit
  SHA, least-privilege workflow permissions, and OIDC instead of static cloud keys.
- The pass or fail decision belongs to conftest and the Rego rules. An optional model call can
  explain a violation in plain words, and it cannot change the result.
- Every rule is mapped to NIST SP 800-171 control IDs, so a failed check points at the
  requirement it relates to. The mapping is an illustrative mapping, not a compliance attestation.
- Every rule has unit tests with passing and failing cases, run with `opa test` and a coverage
  report in CI.
- A committed Terraform plan with violations fails the gate. The fixed plan passes.

**The metric to track.** Violations caught before merge compared with violations found after
deploy. The CLI keeps a small ledger. `check --record` adds each pre-merge catch and `record`
adds a finding from production. `metric` prints both counts and the pre-merge share. The demo
ledger is illustrative fixture data and says so in its output.

What good looks like: the pre-merge share rises over time and each post-deploy finding becomes a
new rule or a tighter one. No benchmark number is claimed here. Your own trend is the baseline.

**Adopt it in a week.**

1. Day 1: run `check` on one repository in report-only mode and read the list.
2. Day 2: fix or explicitly accept each finding. Remove rules your team will not hold to.
3. Day 3: add the Action to pull requests for the Terraform and workflow paths.
4. Day 4: have your assessor or compliance lead review `policies/controls.json`, since the
   mapping is illustrative and they own the real one.
5. Day 5: start recording catches and post-deploy findings in the ledger.

**Limits.**

- Six rules cover a fraction of what a real baseline needs. They are a starting set.
- The rules read the plan, not the running account. Drift and resources made outside Terraform
  are invisible to them.
- Terraform plan values that are unknown until apply (computed names, for example) cannot be
  checked. The encryption rule matches buckets by literal name.
- The control mapping is an illustrative mapping, not a compliance attestation. Passing these
  checks does not make a system compliant with NIST SP 800-171 or any other framework.
- The optional explanation comes from a model. It lists its assumptions and is not evidence.

## For engineers

### Architecture

```mermaid
flowchart LR
  A[Terraform plan JSON<br/>workflow YAML] --> B[conftest + Rego policies]
  B -->|JSON results| C[policy-gates CLI]
  M[controls.json] --> C
  C --> D[violations with control IDs]
  C -.optional.-> E[LLM explanation<br/>zod validated, fallback text]
  C --> F[ledger.json]
  D --> G[exit 0 or 1]
```

The decision path is conftest only. The CLI maps rule IDs to controls and formats output. The
model, when enabled, adds an explanation under each violation and has no input to the exit code.

### Rules

| Rule  | Input     | What it flags                                                                | NIST SP 800-171 (illustrative) |
| ----- | --------- | ---------------------------------------------------------------------------- | ------------------------------ |
| PG001 | Terraform | S3 bucket with a public ACL, or a public access block with any setting false | 3.1.3, 3.1.22, 3.13.1          |
| PG002 | Terraform | S3 bucket without a server-side encryption resource, unencrypted EBS or RDS  | 3.13.16                        |
| PG003 | Terraform | IAM policy statement that allows `*` or `service:*` actions, or `*` resources | 3.1.1, 3.1.5                   |
| PG004 | Workflow  | `uses:` not pinned to a 40 character commit SHA (or a docker digest)         | 3.4.1, 3.4.8                   |
| PG005 | Workflow  | No `permissions` at workflow or job level, or `write-all`                    | 3.1.5                          |
| PG006 | Workflow  | Static cloud credentials in `env` or `with` instead of OIDC                  | 3.5.2, 3.13.10                 |

Control IDs follow NIST SP 800-171 Revision 2. Check them against the current revision before
you rely on them. The rule ID is the prefix of each Rego message (`PG003: ...`), which is how the
CLI looks the controls up.

### Install and run

```bash
pnpm install
conftest --version   # 0.71 or newer on PATH
opa version          # for the rule unit tests
```

```bash
# unit tests for the rules, with coverage
pnpm --filter @adl/policy-gates test:rego

# gate the committed examples
pnpm --filter @adl/policy-gates check examples/terraform/plan-violations.json
pnpm --filter @adl/policy-gates check examples/terraform/plan-fixed.json
```

CLI reference (`tsx src/bin.ts`):

| Command                                              | Does                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| `check [paths...]`                                   | Run conftest, print violations with control IDs, exit 1 on any |
| `metric --ledger FILE [--label TEXT]`                | Print caught-before-merge versus found-after-deploy            |
| `record --ledger FILE --rule ID --stage post-deploy` | Add a finding to the ledger by hand                            |

`check` options: `--policy DIR` (default `policies`), `--mapping FILE` (default
`<policy>/controls.json`), `--ignore REGEX` (default skips `node_modules` and `.git`),
`--json` (machine output), `--record FILE` (append pre-merge catches to a ledger),
`--explain` (model explanation per violation), `--live` (use the Anthropic API instead of
recorded responses; also `DEMO_LIVE=1`). Exit codes: 0 no violations, 1 violations, 2 usage or
runner error. The model comes from `ANTHROPIC_MODEL` through the shared config.

### GitHub Action

The composite action at `pieces/06-policy-gates/action.yml` installs conftest, runs `check` and
fails the job on any violation.

| Input    | Default                        | Meaning                                                                    |
| -------- | ------------------------------ | -------------------------------------------------------------------------- |
| `path`   | `.`                            | Files or directory to test, relative to the workspace. Space separated.    |
| `policy` | empty (the piece's `policies`) | Policy directory, relative to the workspace. Empty uses the bundled rules. |

```yaml
- uses: frankTurtle/rollcage/pieces/06-policy-gates@<commit sha>
  with:
    path: infra/plan.json .github/workflows
```

Pin the action by commit SHA, as the PG004 rule asks of everything else. The action runs on
Linux x86-64 runners.

### Writing a rule

1. Add `policies/<terraform|workflows>/<name>.rego` with a `deny contains msg if` rule whose
   message starts with the next rule ID and a colon.
2. Add `<name>_test.rego` with at least one passing and one failing case.
3. Add the ID to `policies/controls.json` with a title, control IDs and a remediation sentence.
   A test fails if a rule has no mapping entry.

### Tests

```bash
pnpm --filter @adl/policy-gates test:rego   # opa test with coverage threshold
pnpm --filter @adl/policy-gates coverage    # Vitest, 90% line floor
```

Acceptance criteria and where each is tested:

| Criterion                                                          | Test                          |
| ------------------------------------------------------------------ | ----------------------------- |
| Each rule has passing and failing unit tests                       | `policies/**/*_test.rego`     |
| Rego coverage is enforced                                          | `test:rego` threshold, and CI |
| Every rule ID has a control mapping, labeled illustrative          | `tests/mapping.test.ts`       |
| The violating plan fails with control IDs, the fixed plan passes   | `tests/examples.test.ts`      |
| Conftest JSON is parsed and violations carry control IDs           | `tests/conftest.test.ts`      |
| Exit codes and output formats                                      | `tests/cli.test.ts`           |
| The model never changes the decision, and falls back on bad output | `tests/explain.test.ts`       |
| The metric counts pre-merge and post-deploy findings               | `tests/ledger.test.ts`        |
| The action exposes `path` and `policy` and fails on violations     | `tests/action.test.ts`        |

### Runtime dependencies

- `@adl/shared`: LLM client interface, structured output helper, record and replay.
- `zod`: validates conftest output, the mapping file, the ledger and model output.
- `tsx`: runs the TypeScript CLI without a build step.
- External programs, not npm packages: `conftest` and `opa` on PATH.

### Security notes

- Tests and the default demo make no network calls. The model is reached only with `--live`.
- The model gets the rule ID, message, file and resource address. It gets no file contents and
  no credentials.
- Model output is JSON checked with zod. Invalid output retries once, then the CLI prints the
  remediation text from the mapping file and says it fell back.
- Fixtures use obviously fake values only, such as the AWS documentation example key
  `AKIAIOSFODNN7EXAMPLE`.
- The action downloads conftest at a pinned version and checks the SHA-256 from the release's
  checksum file. Pin your own copy and checksum if you need a stronger guarantee.

### Verify before you deploy

Nothing here deploys or calls a cloud. To produce a real plan JSON for your own stack:

```bash
terraform plan -out=tfplan && terraform show -json tfplan > plan.json
pnpm --filter @adl/policy-gates check plan.json
```

The committed plan fixtures were written by hand in the plan JSON shape, not produced by a
Terraform run. Run the commands above against a real plan before you trust the rules on your
stack. The action's conftest download step has also not been run on a GitHub runner.
