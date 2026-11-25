# Demo script: 11 RAG onboarding

Video: "New engineer productive in week one: a RAG agent over your codebase and runbooks."

Run time: about 1 minute, offline, deterministic. Large terminal font. The first run needs
`uv sync` to fetch Python packages. After that, nothing is downloaded.

```bash
pnpm install
pnpm demo:11:reset   # clean state before every take
pnpm demo:11         # the whole demo end to end
```

The sample service (Tidepool Orders) and its runbooks are invented. Say so on camera. The default
demo uses a word-matching embedder and recorded model responses that a script generated. It shows
how answers, citations and refusals look, not how a model performs. Live mode (`--live`) uses a
real embedding model and the Anthropic API and is not part of the recorded demo.

## 0:00 to 0:20, the problem

Say: "A new engineer's first week is mostly questions, and the answers are in files nobody has
read end to end." There is no verified statistic for this piece. `docs/sources.md` has nothing on
onboarding time, so do not quote one on camera.

## 0:20 to 1:00, why it matters

Every question interrupts someone senior. A wrong answer is worse: a runbook step invented during
an incident costs more than the question did. So this agent quotes the file and line, and refuses
when the sources do not say.

## 1:00 to 5:30, screen share

**Before: finding the answer by hand.**

```bash
pnpm demo:11 before
```

Runs a plain text search for "approval" across the sample repo and runbooks and prints each hit
with its file and line. The sample is small, so there is one hit. In a real repository there would
be dozens, with no ranking and no answer, and the reader still has to open files and decide.

**Run: ask questions, including one the docs cannot answer.**

```bash
pnpm demo:11 run
```

Indexes the sample into ChromaDB, then asks four questions. Three get a short answer with
`file:line` citations and the quoted text. The fourth ("Which cloud region hosts the production
cluster?") is refused with "not in the sources", and no model call is made. Point at the
citation line numbers and open one file to show they match.

**After: the eval gate.**

```bash
pnpm demo:11 after
```

Grades all 22 eval questions, 6 of them refusals, and prints accuracy next to the committed
baseline (100 percent, 22 of 22, from recorded real model responses). Say the baseline is a floor,
not a target, and that it covers 22 sample questions only. It ends with PASS. Then say what happens when someone changes retrieval and accuracy
drops: the command exits 1 and CI fails.

## 5:30 to 6:30, the metric

```bash
pnpm demo:11 metric
```

Prints eval accuracy against the baseline, then the median days to first merged PR for a
**synthetic** sample cohort (`demo/onboarding-sample.csv`: a "before the agent" cohort and an
"after" cohort with made-up dates). Say that the cohort numbers are made up, and that the real
metric comes from your own export.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:11 run`: the first answer with its citations, then the refusal.

## Reset

`pnpm demo:11:reset` deletes `pieces/11-rag-onboarding/demo/out`, including the Chroma data.
