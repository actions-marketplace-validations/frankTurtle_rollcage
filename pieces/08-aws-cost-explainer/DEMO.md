# Demo script: 08 AWS cost explainer

Video: "Your AWS bill explained in plain English, every Monday."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:08:reset   # clean state before every take
pnpm demo:08         # the whole demo end to end
```

All spend figures come from a made-up fixture week (2026-11-16 to 2026-11-22 against the week
before). Say so on camera. Nothing touches AWS, Slack or the model: the model's reply is a recorded
fixture, and the notification channels are fakes that print what they would send. `DEMO_LIVE=1`
adds a live model call (needs `ANTHROPIC_API_KEY`); AWS stays untouched.

## 0:00 to 0:20, the problem

Say: "Your AWS bill went up 28% last week and nobody can say why." That 28% is the fixture's
number. `docs/sources.md` has no cost statistic, so this video cites none.

## 0:20 to 1:00, why it matters

AI-assisted teams spin up more services and jobs. A forgotten NAT gateway or a new search domain
bills every day until someone reads the invoice, which is at the end of the month.

## 1:00 to 5:30, screen share

**Before: the raw data.** What Cost Explorer returns is a long list of groups and strings.

```bash
pnpm demo:08 before
```

Prints a slice of the raw rows for last week and the week before. Nobody reads this on Monday.

**Run: the weekly job.** The same code the Lambda runs, with fake AWS ports.

```bash
pnpm demo:08 run
```

Show, in order: the computed table (service, last week, this week, change, flagged material), the
two anomalies, the untagged spend line, then the message that would go to Slack and to SNS.
Point at the sentence that says "Assumption". Point at the line that says the summary came from the
model.

**After: the guard rails.** The model gets it wrong, and the job does not repeat the error.

```bash
pnpm demo:08 after
```

Feeds the job a model reply that quotes a dollar figure that is not in the data. The message goes
out with the deterministic summary and a line saying why. Then the Slack channel fails and the
email still goes out.

## 5:30 to 6:30, the metric

```bash
pnpm demo:08 metric
```

Prints unexplained spend for the week (dollars and share of total) and, for each anomaly, the days
from start to this report next to the days it would have run if you only read the monthly
invoice. Fixture numbers, labeled as such.

## 6:30 to 7:00, close

"The template is free in the repo." Mention that it deploys in fixture mode first, live mode is
read-only, and Cost Explorer requests are billed per request, so check AWS's current price.

## Clip cut (60 to 90 seconds)

From the start of `run` to the end of `metric`: the computed table, the plain-English message, the
rejected invented figure, and the notice-time line.
