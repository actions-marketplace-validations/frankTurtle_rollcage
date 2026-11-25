# Demo script: 14 AI dev tool eval

Video: "Copilot, Cursor, Claude Code: what to standardize on, and how to govern it."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:14:reset   # clean state before every take
pnpm demo:14         # the whole demo end to end
```

The demo uses **placeholder** tools, A, B and C, and made-up scores. Say so on camera. It shows
how the scoring reads, not which tool to buy.

## 0:00 to 0:20, the problem

Say: "Your team already uses more than one AI coding tool. Which one do you standardize on, and
who checks where the code goes?" Nothing on screen yet.

## 0:20 to 1:00, why a rubric

Feature lists answer a different question. The rubric asks the same questions of every tool, in the
same order, and writes the answer down with the evidence behind it. Five groups: data handling,
admin controls, audit logs, cost, and measured productivity.

## 1:00 to 3:00, the scorecard

**Show the input.**

```bash
cat pieces/14-ai-dev-tool-eval/scorecard.example.csv
```

Point out the shape: criteria as rows, tools as columns, one score from 0 to 3 per cell. The
placeholder names matter. Real vendor names go in a file you keep out of the public repo.

**Run the scores.**

```bash
pnpm demo:14 score
```

Show the weighted score for each tool and the ranking. Point at the gate line: Tool C scores 0 on
a gate criterion, so it is blocked and sits below the unblocked tools whatever its total. Say:
"The total does not buy back a failed gate."

## 3:00 to 4:00, the links

```bash
pnpm demo:14 links
```

The demo checks every relative link in this piece's markdown offline. It does not fetch external
URLs. Say: "The checker only goes to the network when you ask it to with `--live`."

## 4:00 to 5:00, the pilot

Open `PILOT.md`. Show the five metrics, the split date, and the decision rule. Say: "The pilot uses
the same delivery numbers as piece 03. Before and after come from the same definitions." Do not run
the pilot on camera. It takes 30 days.

## 5:00 to 5:30, close

Say: "Score from evidence you can point to. Read the gates before the totals. Pilot before you
standardize." Then reset:

```bash
pnpm demo:14:reset
```
