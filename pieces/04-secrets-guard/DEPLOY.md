# Deploying layer 3

Deploy this in a sandbox AWS account first. It was deployed and tested end to end once, on
2026-11-25, in us-east-1, with a signed test webhook against a permissionless canary IAM user.
That test found one bug (a `#` in an IAM tag value), which is fixed. Everything below is IaC, so
one command removes it.

## What it creates

One stack, `secrets-guard`, with:

| Resource                    | Purpose                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| Lambda function (arm64, Node.js 24) | The webhook handler, reserved concurrency 2.                         |
| Lambda Function URL         | Public HTTPS endpoint; the HMAC signature is the only gate.          |
| Secrets Manager secret      | The generated webhook secret.                                        |
| DynamoDB table (on demand)  | Audit records. Retained on delete by default; `RetainAuditTable=false` removes it with the stack. |
| SNS topic (+ email, if set) | Notifications.                                                       |
| CloudWatch log group        | 90-day retention.                                                    |
| IAM role                    | Least privilege, no delete permission, scoped to the guarded path.   |

## What it costs

Small, but not zero. Lambda and SNS are well inside free usage for this traffic. The Secrets
Manager secret is billed per month and per 10,000 API calls, DynamoDB on demand is billed per
request, and CloudWatch Logs per GB. I did not read AWS's current price pages, so check them:
https://aws.amazon.com/secrets-manager/pricing/ and https://aws.amazon.com/dynamodb/pricing/.

## Before you deploy, verify

See "Verify before you deploy" in the README. In short: the IAM user-path scoping has not been run
against AWS, and nothing here has been deployed.

## Steps

```bash
cd pieces/04-secrets-guard
sam validate --lint --template-file template.yaml     # offline
pnpm --filter @adl/secrets-guard build:lambda          # bundles the handler and the AWS SDK clients
sam build                                             # copies the bundle (dist/lambda), offline
sam deploy --guided                                   # needs sandbox credentials; asks for parameters
```

Parameters to choose deliberately: `AllowedAccountIds` (the sandbox account id), `UserPath` (leave
the default), `DryRun` (leave `true`), `RetainAuditTable` (`false` for a throwaway demo).

Non-interactive form, with every resource tagged so you can find it in the console (Resource
Groups, Tag Editor, or Cost Explorer once the tags are activated as cost allocation tags):

```bash
sam deploy --stack-name rollcage-secrets-guard --resolve-s3 --capabilities CAPABILITY_IAM \
  --parameter-overrides AllowedAccountIds=<account-id> DryRun=true RetainAuditTable=false \
  --tags project=rollcage piece=04-secrets-guard repo=rollcage managed-by=sam
aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=rollcage
```

Then, in the GitHub repository, add a webhook: payload URL = the `WebhookUrl` output, content type
`application/json`, secret = the value in the `WebhookSecretArn` secret, event = "Secret scanning
alerts". Read the secret with `aws secretsmanager get-secret-value`, and do not paste it anywhere
else.

## A live test, safely

1. Create the canary user (a permissionless IAM user under the guarded path) with
   `aws cloudformation deploy --stack-name rollcage-secrets-guard-canary --template-file canary.template.yaml --capabilities CAPABILITY_NAMED_IAM --tags project=rollcage`,
   then create one access key for it with `aws iam create-access-key --user-name leak-test`.
   Keep only the key id; do not print the secret half anywhere.
2. Do not commit that key. Use GitHub's own secret scanning test flow, or a private repository you
   control, and delete everything afterwards.
3. With `DryRun=true`, confirm the audit table and the notification say "would deactivate".
4. Only then, if you want to see a real deactivation, redeploy with `DryRun=false` and repeat.
5. Delete the key (`aws iam delete-access-key`), then the canary stack.

What the 2026-11-25 test showed: a bad signature gets 401; a good one in dry run returns
`dry-run` and leaves the key Active; with `DryRun=false` the key goes Inactive and the user gets
two `secrets-guard-*` tags; a second delivery for the same key returns `already-inactive`.
GitHub's own secret scanning delivery was not tested.

Never put a real key in a document, a screen recording or a shared terminal.

## Tear down

```bash
aws iam delete-access-key --user-name leak-test --access-key-id <id>   # if one still exists
aws cloudformation delete-stack --stack-name rollcage-secrets-guard-canary
sam delete --stack-name rollcage-secrets-guard --no-prompts
```

With `RetainAuditTable=false` the audit table goes with the stack. If you deployed with the default
(`true`), export what you need first, then run `aws dynamodb delete-table`. Also remove the webhook
in GitHub and any email subscription. `sam delete` leaves the shared SAM artifact bucket alone.
The teardown commands have not been run on this stack yet.
