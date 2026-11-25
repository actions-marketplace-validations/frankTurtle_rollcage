# Demo script: 06 Policy gates

Video: "Move compliance checks into the pipeline." The hook line is added by the orchestrator.

Run time: about 2 minutes, offline, deterministic. Large terminal font. Needs `conftest` on PATH.

```bash
pnpm install
pnpm demo:06:reset   # clean state before every take
pnpm demo:06         # the whole demo end to end
```

The Terraform plans are small hand-written fixtures in the plan JSON shape, and the ledger numbers
are illustrative fixture data. Say so on camera.

## 0:00 to 0:20, the problem

Say: "AI writes infrastructure changes faster than anyone reads them." Stat reference:
DORA 2025 associates higher AI adoption with higher delivery instability, so more throughput
needs stronger checks (`docs/sources.md`, VERIFY, say "associated with").

## 0:20 to 1:00, why it matters

A public bucket or a wildcard IAM policy found after deploy is an incident and an audit finding.
Found in the pull request, it is a one line fix. Each rule says which control it relates to, so
the person fixing it sees why.

## 1:00 to 5:30, screen share

**Before: a plan with violations.**

```bash
pnpm demo:06 before
```

Shows the offending settings in the plan and the workflow: a public ACL, no encryption, an IAM
policy with `*`, an unpinned action, no permissions block, a static AWS key.

**Run: the gate.**

```bash
pnpm demo:06 run
```

The gate fails with exit code 1. Each violation line carries its rule ID and the NIST SP 800-171
control IDs. A footer says the mapping is illustrative and not a compliance attestation. Point
out that the explanation under each violation comes after the decision and cannot change it.

**After: apply the fix, run again.**

```bash
pnpm demo:06 after
```

Shows the diff between the violating and fixed files, runs the gate on the fixed files, and
prints "passed" with exit code 0.

## 5:30 to 6:30, the metric

```bash
pnpm demo:06 metric
```

Prints violations caught before merge against violations found after deploy, from the
illustrative ledger, with the pre-merge share.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:06 run` (the failure with control IDs) straight into the passing run from
`pnpm demo:06 after`.

## Unit tests on camera (optional)

```bash
pnpm --filter @adl/policy-gates test:rego
```

## Reset

`pnpm demo:06:reset` deletes `pieces/06-policy-gates/demo/out`.
