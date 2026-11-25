# Demo script: 13 multi-agent workflow

Video: "Agents as accelerators, not oracles: a reviewable multi-agent workflow."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:13:reset   # clean state before every take
pnpm demo:13         # the whole demo end to end
```

The model replies are recorded fixtures (`fixtures/replies-*.json`), so no API call is made. The
task, files and test results are made up. Say so on camera. The demo shows how the record reads,
not how good any model is. `DEMO_LIVE=1` is not used by this demo.

## 0:00 to 0:20, the problem

Say: "An agent opened a change. Which agent decided what, and who let it merge?" Stat: 84% of
developers use or plan to use AI tools (Stack Overflow 2025; `docs/sources.md`, VERIFY). Most of
that use leaves a chat transcript and a commit message.

## 0:20 to 1:00, why it matters

When an AI-written change breaks something, the postmortem needs inputs, outputs, tool calls and
the approval decision. Without them the answer is "the AI did it", which cannot be fixed or
audited. A human checkpoint before a shared branch is the cheapest control that works.

## 1:00 to 5:30, screen share

**Before: what an unattended agent leaves behind.**

```bash
pnpm demo:13 before
```

Prints one commit message and then lists what is missing: no input hash, no tool calls, no
decision, no approver.

**Run: planner to reviewer.**

```bash
pnpm demo:13 run
```

Prints each handoff as it happens: agent, input hash, tools called, decision. The run ends at
`awaiting-approval` and stops. Point at the line that says nothing was committed.

**After: block, approve, commit, replay, tamper.**

```bash
pnpm demo:13 after
```

In order:

1. A commit to `develop` with no approval is blocked. Show the reason and that the committer was
   never called.
2. An agent name tries to approve and is rejected.
3. A human approves the exact change. The commit goes through the dry-run committer.
4. The recorded run replays: reducer replay, handoff check, re-execution. All three match.
5. One character of a ledger is edited. Replay fails and names the handoff.

Optionally show the CI check that grades the agents' trajectories:

```bash
pnpm --filter @adl/multi-agent-workflow eval:gate
```

## 5:30 to 6:30, the metric

```bash
pnpm demo:13 metric
```

Prints the share of changes with a complete trace and the rework rate, over two recorded fixture
runs (one clean, one where the reviewer asked for a change). Both numbers are labeled as fixture
data.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

Take the `after` stage from the blocked commit through the approval to the tamper check. It has a
problem, a control, and a visible failure in one pass.
