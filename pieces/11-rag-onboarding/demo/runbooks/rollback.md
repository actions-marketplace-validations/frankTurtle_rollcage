# Runbook: roll back a release

Use this when a release is already serving traffic and must be undone.

## Decide

Roll back first and investigate after. A rollback that was not needed costs ten minutes. A bad
release left running costs orders.

## Steps

1. Find the previous good version in the release history. It is the last entry marked "promoted".
2. Run the `release` workflow with that version's SHA and the `production` environment.
3. Choose "skip canary" only if the incident commander approves it.
4. Check that the error rate on the orders dashboard returns to under 1 percent within 15 minutes.
5. Record the rollback in the incident channel with the old and new version numbers.

## Database migrations

Migrations are forward only. Never run a down migration in production. If the bad release
included a migration, ask the database owner for a fix-forward change instead.
