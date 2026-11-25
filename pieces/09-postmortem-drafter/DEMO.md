# Demo script: 09 Postmortem drafter

Video: "Postmortem drafted before the bridge call ends."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:09:reset   # clean state before every take
pnpm demo:09         # the whole demo end to end
```

The demo generates an incident bundle with made-up data and planted fake secrets, and uses a
scripted stand-in for the model (the demo says so). `DEMO_LIVE=1` with `ANTHROPIC_API_KEY` calls
the real model instead. Say on camera that the incident is fictional.

## 0:00 to 0:20, the problem

Say: "The incident is over and the postmortem is a blank page." DORA's guide associates higher AI
adoption with higher delivery instability (`docs/sources.md`, VERIFY), so there will be more of
these. Reading logs, chat and deploys by hand is the part that gets skipped.

## 0:20 to 1:00, why it matters

A late postmortem loses detail, and pasting raw logs and chat into an AI tool leaks emails,
addresses and keys. The draft has to be fast and safe to produce.

## 1:00 to 5:30, screen share

Before: the raw bundle.

```bash
pnpm demo:09 before
```

Prints the bundle files and how many sensitive values each type has, counts only. Point at the
number: this is what would go to the API without a redaction pass.

Run: draft the postmortem.

```bash
pnpm demo:09 run
```

Builds the timeline, redacts, calls the model, and writes `postmortem.md` and
`redaction-report.json`.

After: the draft and the redaction report.

```bash
pnpm demo:09 after
```

Prints the draft. Point at three things: the timeline in UTC, the contributing factors marked as
hypotheses, and the blank owner column. Then the redaction report: counts and types, no values.

## 5:30 to 6:30, the metric

```bash
pnpm demo:09 metric
```

Prints time from incident close to published postmortem and the share of incidents with one, from
a fixture `incidents.json`. Label these as fixture numbers.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:09 before` (the counts), then the top of `pnpm demo:09 after` (summary, timeline, empty
owners), then the redaction report.

## Reset

`pnpm demo:09:reset` deletes `pieces/09-postmortem-drafter/demo/out`.
