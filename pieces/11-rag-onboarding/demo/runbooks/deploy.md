# Runbook: deploy to production

Owner: platform team. Audience: any engineer who has finished onboarding.

## Before you start

- Staging must be green on the commit you want to ship.
- No deploys on Fridays after 14:00 local time unless the on-call engineer agrees.
- You need the `deployer` role in the access portal. Request it from your manager.

## Steps

1. Open the `release` workflow and choose "Run workflow".
2. Enter the commit SHA from staging and select the `production` environment.
3. Wait for the canary step. It sends 5 percent of traffic to the new version for 10 minutes.
4. If the canary error rate stays under 1 percent, the workflow promotes to 100 percent.
5. Post the version number in `#orders-releases`.

## If the canary fails

The workflow rolls back by itself. Do not retry the same SHA. Open an incident and follow the
rollback runbook if traffic has already moved.
