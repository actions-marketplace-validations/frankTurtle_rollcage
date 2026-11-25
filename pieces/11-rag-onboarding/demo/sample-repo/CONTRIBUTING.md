# Contributing to Tidepool Orders

## Your first pull request

1. Pick an issue labelled `good-first-issue`.
2. Branch from `main` and name the branch `<your-handle>/<short-topic>`.
3. Run `make test` and `make lint` before you push. Both must pass.
4. Open a pull request. Keep it under 400 changed lines, or split it.
5. Two approvals are required. One of them must come from a code owner listed in `CODEOWNERS`.

## Commit messages

Use Conventional Commits, for example `fix(pricing): round discounts down`. The commit-msg hook
rejects anything else.

## Review expectations

Reviewers answer within one working day. If nobody has looked after two working days, post in
the `#orders-dev` channel and tag the on-call engineer.

## Releases

Merging to `main` deploys to staging automatically. Production deploys are started by hand
from the release workflow, as described in the deploy runbook.
