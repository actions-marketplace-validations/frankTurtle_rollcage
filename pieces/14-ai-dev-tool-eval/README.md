# 14 AI dev tool eval

A vendor-neutral rubric, a 30-day pilot plan, and a small script that turns a scorecard into
weighted scores and a ranking. The pilot reads its before and after delivery numbers from
[piece 03](../03-dora-metrics/README.md).

## For engineering leaders

**The problem.** Teams end up with several AI coding tools at once: an editor assistant, a
terminal agent, a review bot. Each one sends code and prompts somewhere, keeps logs somewhere, and
bills in its own unit. Comparisons usually start from feature lists and demos. This piece gives
you the questions in a fixed order, a way to write the answers down, and a pilot that measures
delivery before and after a tool arrives.

**What this proves.**

- Five groups of criteria with default weights. Every criterion has a 0 to 3 scale with written
  levels, so a score says which evidence it rests on.
- One hard gate. A tool that scores 0 on training use, or on audit export, is blocked whatever its
  total says.
- A scorecard you can rerun next quarter. The script is deterministic and makes no network calls.
- A pilot that uses the same five delivery metrics as piece 03, split at the day the tool arrives.
- No vendor facts in this repository. The example scores three placeholder tools, A, B and C.

**The rubric.** The full criteria and level descriptions are in [RUBRIC.md](RUBRIC.md).

| Group                        | Default weight | What it asks                                                                                       |
| ---------------------------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Data handling and security   | 35             | Where code and prompts go, whether training uses them, what context is sent, how identity works.   |
| Admin and governance         | 25             | Who can turn features on, which models and tools are allowed, how seats are removed.              |
| Audit logging                | 15             | Whether an admin can see what the tool did, and whether that record can be exported.              |
| Cost                         | 10             | Whether the price can be predicted and capped, and what the pilot says it costs per merged change. |
| Measured productivity        | 15             | What the delivery metrics did during the pilot, and whether instability moved with them.          |

**What "good" looks like.** No score is a pass mark. Read the gate results first, then the
ranking. Use the ranking to choose which tool to pilot, and the pilot to decide. The weights are a
starting point that encodes one set of priorities; change them when your priorities differ, and
write down why.

**Adopt it in a month.**

1. Week 1: copy `scorecard.example.csv` to a file you keep out of the public repo, because it will
   name real vendors. Read each vendor's own documents and record the URL and the date you read
   them.
2. Week 1: score each criterion from that evidence. A 3 needs a document or a test you can point to.
3. Week 2: run the script. Fix any validation error before you look at a total.
4. Weeks 2 to 6: run the pilot in [PILOT.md](PILOT.md). Keep the rollout date fixed in advance.
5. Week 6: re-score the measured productivity group from the pilot numbers, rerun the script, and
   apply the decision rule in PILOT.md.

**Limits.**

- The rubric records evidence as of the day you read it. Vendor terms and plans change often, so
  re-read them before each decision.
- A before and after comparison shows what changed. It does not show why. A tool rollout is rarely the only
  change in a month (see piece 03's limits).
- A small team gives few deployments per period. Piece 03 reports those periods as insufficient
  data, and the decision rule in PILOT.md records that as "no decision yet".
- The script checks arithmetic and structure. It cannot check whether a score is honest.

## Quickstart

```bash
pnpm install
pnpm demo:14
```

The demo scores the example scorecard, prints the ranking, and checks the links in this piece's
markdown offline. It takes well under a minute and writes `demo/out/scores.json`.
`pnpm demo:14:reset` removes it.

## How to adopt

See "Adopt it in a month" above. The short version: score from documents you read yourself, run
the script, read the gates, pilot the top candidate with piece 03 measuring before and after, then
decide with the rule in PILOT.md.

## Principles

- Deterministic decisions. Weights, gates, scores and the ranking are code. Nothing here calls a
  model.
- Fail closed. A missing score, an out-of-range score or an unknown criterion is an error. The
  script never reads it as zero, and it exits non-zero.
- No network by default. The link checker reads external URLs only when you pass `--live`. Tests
  never do.
- No secrets. The example scorecard and fixtures contain placeholder names and numbers only.

## About the author

See the repository root [README](../../README.md).

## License

MIT. See the repository root [LICENSE](../../LICENSE).

## For engineers

### Layout

| Path                         | What it is                                                                 |
| ---------------------------- | -------------------------------------------------------------------------- |
| `RUBRIC.md`                  | Criteria, level descriptions, default weights. Human-readable source.       |
| `weights.json`               | Criterion IDs, groups, weights and gate flags. Read by the script.         |
| `PILOT.md`                   | 30-day pilot plan, piece 03 metrics, split date, sample caveats, decision rule. |
| `scorecard.example.csv`      | Example scorecard: criteria as rows, tools as columns, placeholder names.  |
| `src/score.ts`               | Validation and weighted scoring. Pure functions.                           |
| `src/cli.ts`, `src/bin.ts`   | `score` and `links` commands. `bin.ts` is a thin entry point.              |
| `src/links.ts`               | Markdown link extraction, offline checks, opt-in live checks.              |
| `tests/`                     | Vitest tests, one file per area of the acceptance criteria.               |
| `demo/demo.sh`               | Offline demo driver.                                                       |

### Scoring

For tool `t` with score `s[c]` in 0 to 3 on criterion `c` with weight `w[c]`:

    score(t) = 100 * sum(w[c] * s[c]) / (3 * sum(w[c]))

The result is 0 to 100. A criterion with a gate flag that scores 0 marks the tool as blocked.
Ranking: unblocked tools first, by score descending; blocked tools after them, by score
descending. Equal scores sort by tool name, so the output never depends on file order.

### Commands

```bash
pnpm --filter @adl/ai-dev-tool-eval exec tsx src/bin.ts score \
  [--root DIR] [--scorecard FILE] [--weights FILE] [--out FILE]
pnpm --filter @adl/ai-dev-tool-eval exec tsx src/bin.ts links [--root DIR] [--live]
```

Paths default to the current folder: `scorecard.example.csv` and `weights.json`. `score` exits 1
and prints every validation error it finds. `links` exits 1 when a relative link is broken, or,
with `--live`, when an external URL fails. Without `--live` external links are counted as skipped.

### Acceptance criteria (each has a test)

| ID   | Criterion                                                                                                  | Test file                  |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------- |
| AC1  | The rubric has the five groups; every criterion has levels 0 to 3 and a default weight; weights sum to 100. | `tests/rubric.test.ts`     |
| AC2  | `RUBRIC.md` and `weights.json` agree on every criterion ID, group and weight.                             | `tests/rubric.test.ts`     |
| AC3  | The example scorecard validates and its tools are placeholders named Tool A, Tool B and Tool C.            | `tests/scorecard.test.ts`  |
| AC4  | Weighted scores match hand-computed values for a fixture, including the 0 to 100 scale.                    | `tests/score.test.ts`      |
| AC5  | Validation rejects a missing score, a score outside 0 to 3, a non-integer, an unknown or duplicate criterion, a duplicate tool and a non-positive weight. | `tests/scorecard.test.ts` |
| AC6  | A tool scoring 0 on a gate criterion is blocked and ranks below every unblocked tool.                      | `tests/score.test.ts`      |
| AC7  | Ranking is deterministic: equal scores sort by tool name, independent of column order.                     | `tests/score.test.ts`      |
| AC8  | `score` prints the scores and ranking and writes `--out` JSON; invalid input exits 1 with the messages.    | `tests/cli.test.ts`        |
| AC9  | The link checker finds inline, reference and autolinks, ignores code, fails missing relative files and same-file anchors, and checks external URLs only through an injected fetcher. | `tests/links.test.ts` |
| AC10 | `PILOT.md` names the five piece 03 metrics, the `--compare-at` split, `min_samples`, and a decision rule.    | `tests/pilot.test.ts`      |

### Tests

Tests never touch the network. The live link check takes a fetcher as an argument, and the tests
pass a fake one. Coverage floor: 90% lines, statements and functions, 85% branches, matching
piece 03.

### Runtime dependencies

- `zod`: validates the weights file and scorecard cells, with the same major version as piece 03.

Nothing else at runtime. The CLI uses `node:util`, `node:fs` and `node:path`.

### Status

Built on `feature/14-ai-dev-tool-eval`. Not yet reviewed by a maintainer. The rubric's vendor
references, if you add any, must go in `docs/sources.md` with the date read and a VERIFY flag.
