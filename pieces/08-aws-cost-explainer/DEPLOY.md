# Deploying the AWS cost explainer

Deploy this in a sandbox AWS account first. It was deployed once in fixture mode on 2026-11-25, in
us-east-1, and invoked by hand: it built the fixture report, used the deterministic summary (no
model configured), and published to SNS. Live mode (real Cost Explorer calls) has not been run.
Everything below is infrastructure as code, so one command removes it.

## What it creates

One stack, `rollcage-aws-cost-explainer`, with:

| Resource                            | Purpose                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Lambda function (arm64, Node.js 24) | Builds the weekly report. Reserved concurrency 1, 120 second timeout.     |
| EventBridge schedule                | Runs the function weekly. Default `cron(0 8 ? * MON *)`, UTC.             |
| SNS topic (+ email, if set)         | The email channel.                                                        |
| CloudWatch log group                | 90-day retention.                                                         |
| IAM role                            | `ce:GetCostAndUsage` and `ce:GetAnomalies`, publish to the one topic, and read of the secrets you pass in. No write access to anything else. |

It creates no database and no bucket of its own, so nothing is retained after deletion. Secrets
Manager secrets (the Slack webhook URL, the model key) are yours and are not created by the stack.

## What it costs

Small, not zero. I did not read AWS's current price pages, so check them:

- Cost Explorer API requests are billed per request. A run makes four `GetCostAndUsage` calls and
  one `GetAnomalies` call, plus extra pages if a result is large. Price:
  https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/
- Lambda, EventBridge Scheduler and SNS email are small at one run a week.
- Each Secrets Manager secret you create is billed per month and per API call:
  https://aws.amazon.com/secrets-manager/pricing/
- CloudWatch Logs is billed per GB ingested; one run writes a few lines.
- The model call, if you enable it, is billed by the model provider.

In fixture mode (the default) the function makes no Cost Explorer calls.

## Before you deploy, verify

See "Verify before you deploy" in the README. In short: fixture mode has run on AWS; live mode has
not, and the Cost Explorer request shapes were written from the SDK types and documentation.

The weekly schedule is an EventBridge Scheduler schedule. Scheduler schedules cannot carry tags, so
it does not appear in a `project=rollcage` tag search, but it belongs to the stack and is deleted
with it.

## Steps

```bash
cd pieces/08-aws-cost-explainer
sam validate --lint --template-file template.yaml     # offline
pnpm --filter @adl/aws-cost-explainer build:lambda     # bundles the handler and the AWS SDK clients
sam build                                              # copies the bundle (dist/lambda), offline
```

Deploy in fixture mode first. It sends the made-up report, so you can see the message, the SNS
subscription and the schedule work without touching your billing data. Every resource is tagged so
you can find it (Resource Groups, Tag Editor, or Cost Explorer once the tags are activated as cost
allocation tags):

```bash
sam deploy --stack-name rollcage-aws-cost-explainer --resolve-s3 --capabilities CAPABILITY_IAM \
  --parameter-overrides DataSource=fixture NotifyEmail=you@example.com \
  --tags project=rollcage piece=08-aws-cost-explainer repo=rollcage managed-by=sam
aws resourcegroupstaggingapi get-resources --tag-filters Key=project,Values=rollcage
```

Confirm the SNS subscription from the email AWS sends. Then run it once without waiting for Monday:

```bash
aws lambda invoke --function-name <FunctionName output> --payload '{}' --cli-binary-format raw-in-base64-out /dev/stdout
```

## Going live (read-only)

1. In the Billing console, activate your cost allocation tag (default key `team`). Cost Explorer
   cannot group by a tag until it is active, and it can take up to a day to appear.
2. Make sure Cost Anomaly Detection has at least one monitor.
3. Optional Slack: create a Slack incoming webhook, then store its URL as a secret you own:
   `aws secretsmanager create-secret --name rollcage/cost-explainer/slack --secret-string '<webhook URL>' --tags Key=project,Value=rollcage`.
   Pass the secret's ARN as `SlackWebhookSecretArn`. Do not paste the URL anywhere else.
4. Optional model summary: store a model API key the same way and pass `AnthropicKeySecretArn`, and
   `AnthropicModel` if you want a specific model. Without it, the deterministic summary is sent. Note
   that the service names, tag values and amounts are sent to the model provider's API.
5. Redeploy with `DataSource=live`:

```bash
sam deploy --stack-name rollcage-aws-cost-explainer --resolve-s3 --capabilities CAPABILITY_IAM \
  --parameter-overrides DataSource=live NotifyEmail=you@example.com TagKey=team \
    ExpectedChanges="AWS Lambda" SlackWebhookSecretArn=<arn> \
  --tags project=rollcage piece=08-aws-cost-explainer repo=rollcage managed-by=sam
```

To read live data from a laptop instead, with your own read-only credentials and no deployment:
`pnpm --filter @adl/aws-cost-explainer cost-explainer report --live`. It prints and sends nothing.

## What to check on the first live run

- The totals match the Cost Explorer console for the same two weeks (allow for revisions to recent
  days).
- Untagged spend appears as `(untagged)` and matches the console's "No tag key" group.
- Anomalies listed match Cost Anomaly Detection in the console.
- The role really cannot do anything else: look at the role in IAM and confirm the Cost Explorer
  actions are the only two, and that the secret read is limited to the ARNs you passed.

## Tear down

```bash
sam delete --stack-name rollcage-aws-cost-explainer --no-prompts
aws secretsmanager delete-secret --secret-id rollcage/cost-explainer/slack   # if you created it
```

Remove any email subscription you no longer want. `sam delete` leaves the shared SAM artifact
bucket alone. The teardown commands have not been run on this stack.
