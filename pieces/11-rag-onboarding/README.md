# 11 RAG onboarding

A command line agent that answers a new engineer's questions about your codebase and your
runbooks, quotes the exact lines it relied on as `file:line`, and says "not in the sources"
when the answer is not there. It is the repo's first Python piece.

## For engineering leaders

**The problem.** A new engineer spends the first weeks asking the same questions: how do I get a
pull request merged, what do I do when the queue backs up, who approves a deploy. The answers
exist, scattered across a README, a contributing guide and runbooks that few people have read
end to end. Each question interrupts a senior engineer.

**What this proves.**

- A new engineer gets an answer in seconds, with the file and line to check it against.
- Every citation is a verbatim quote that the code verified against the indexed file. A quote the
  model made up is dropped, not shown.
- When the sources are silent the agent refuses. A confident wrong runbook step during an
  incident is worse than no answer.
- Quality is measured. An eval set of 22 question and answer pairs, 6 of them refusals, runs in
  CI, and the build fails if accuracy drops below the committed baseline.
- The default path is offline and deterministic, so the same question gives the same answer and
  nothing leaves the machine. Live mode is opt-in.

**The metric.** Two numbers.

| Metric                                     | How this piece measures it                                                                                                            | What good looks like                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Time to first merged PR for new engineers  | `metric` command: median days from start date to first merged PR, from a CSV you export from your HR system and GitHub.              | Falling cohort over cohort. No threshold is claimed; use your own history.     |
| Eval accuracy                              | `eval` command: share of the eval questions answered correctly or correctly refused, against `eval/baseline.json`.                   | At or above the committed baseline. Raise the baseline only on purpose.        |

Time to first merged PR is measured outside the agent. The agent cannot cause it, and a drop
after rollout shows correlation only. The eval accuracy is the number this piece can stand
behind on its own.

**Adopt it in a week.**

1. Day 1: point `rag.yml` at your repository and your `runbooks/` folder. Run `index`.
2. Day 2: write 20 real questions that new engineers asked, and the line that answers each.
   Add 5 or more questions whose answers are not written down anywhere. Put them in the eval set.
3. Day 3: run `eval`, read the failures, fix the docs where the docs were wrong, and commit the
   first baseline.
4. Day 4: put `eval` in CI so a change to retrieval or prompts cannot lower accuracy unnoticed.
5. Day 5: give the next new hire the agent, and track days to first merged PR for that cohort.

**Limits.**

- It answers from the files it indexed. If a runbook is out of date, the answer is out of date,
  and it cites the stale line. The citation is there so a human can see that.
- It does not know your people, tickets or chat history. Questions about those are refused.
- Retrieval quality depends on the embedder. The offline embedder matches words, not meaning.
  The ONNX model handles paraphrases better but downloads a model on first use.
- A refusal test only covers the questions in the eval set. Near-miss questions that share
  vocabulary with the docs are the hard case, and live-mode behavior on them is not verified here.
- The sample data is invented. The accuracy numbers describe the sample, not your docs.

## For engineers

### Architecture

```mermaid
flowchart LR
  F[sample-repo + runbooks] --> L[loader: files to numbered lines]
  L --> C[chunker: line windows with start and end line]
  C --> E[Embedder interface]
  E --> S[(ChromaDB)]
  Q[question] --> E
  S --> R[retrieve top k]
  R --> G{deterministic gate: score and word coverage}
  G -- fails --> X[refuse: not in the sources]
  G -- passes --> M[LlmClient interface]
  M --> V[pydantic validate, retry once]
  V -- invalid twice --> B[extractive answer from cited lines]
  V --> K[verify each quote is verbatim in its chunk]
  K --> A[answer with file:line citations]
  B --> A
```

- Deterministic code decides whether to answer. The gate uses retrieval score and the share of the
  question's content words found in the retrieved text. The model never decides alone to answer.
- The model writes the answer and picks quotes. Code then checks each quote is a verbatim
  substring of the chunk it names and computes the line numbers itself. A quote that fails the
  check is dropped. If no citation survives, the answer becomes the extractive fallback.
- Two interfaces keep tests offline. `Embedder` has a hashed bag-of-words implementation for tests
  and the default demo, and an ONNX implementation (ChromaDB's bundled MiniLM) for live mode.
  `LlmClient` has a scripted fake, a record and replay wrapper, an offline generator that produced
  the committed fixtures, and an Anthropic client over plain HTTP.

### Install and run

Needs `uv` and Python 3.12 or newer. Nothing is downloaded at run time in the default mode.

```bash
pnpm install
pnpm demo:11                        # offline demo, deterministic
pnpm --filter @adl/rag-onboarding coverage

# Directly, from pieces/11-rag-onboarding:
uv sync
uv run rag-onboarding index --config rag.yml
uv run rag-onboarding ask "How many approvals does a pull request need?"
uv run rag-onboarding eval
uv run rag-onboarding metric demo/onboarding-sample.csv
```

Live mode is opt-in with `--live` or `DEMO_LIVE=1`. It uses the ONNX embedder, which downloads a
model on first use (Chroma caches it under `~/.cache/chroma`), and the Anthropic Messages API
over HTTP. It needs `ANTHROPIC_API_KEY`, and the model id comes from `ANTHROPIC_MODEL`.

### Config (`rag.yml`)

| Key             | Default                                         | Meaning                                                                |
| --------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `sources`       | `demo/sample-repo`, `demo/runbooks`             | Folders to index. The folder name is the first part of each citation.  |
| `extensions`    | `.md .py .ts .yml .yaml .toml .txt`, `Makefile` | File types to index.                                                   |
| `chunk_lines`   | `8`                                             | Lines per chunk window.                                                |
| `chunk_overlap` | `2`                                             | Lines shared by neighbouring chunks. Must be below `chunk_lines`.      |
| `top_k`         | `4`                                             | Chunks retrieved per question.                                         |
| `min_score`     | `0.15`                                          | Smallest cosine similarity of the best chunk. Below it, refuse.        |
| `min_coverage`  | `0.6`                                           | Smallest share of question content words found in retrieved text.      |
| `index_dir`     | `demo/out/chroma`                               | Where ChromaDB keeps the index. Rebuilt when the sources change.       |
| `fixtures_dir`  | `eval/llm-fixtures`                             | Recorded model responses used in the default (replay) mode.            |
| `eval_set`      | `eval/eval_set.json`                            | The question and answer pairs.                                         |
| `baseline`      | `eval/baseline.json`                            | The accuracy CI must not fall below.                                   |

Relative paths are relative to the config file. Unknown keys and out of range values are rejected. `min_score` is tuned for the offline embedder.
Re-tune it with the eval set before using the ONNX embedder.

### Citations

A citation is `path:start-end` (or `path:line` for one line) plus the quoted text. The path is
relative to the parent of the indexed folder, for example `runbooks/deploy.md:16`. Line numbers
are 1-based and computed by the code from the quote's position in the file, not by the model.

### Eval set and baseline

`eval/eval_set.json` holds the questions. Each answerable question names a `path` and a `line`
that a correct citation must cover. Each refusal question has `"refuse": true`. A question
counts as correct when it is answered with a citation that covers the expected line, or when
a refusal question is refused. `eval/baseline.json` stores the accuracy to beat. It is 100 percent (22 of 22) today, measured by replaying
fixtures recorded from a real model (`claude-sonnet-5-5`) with the offline embedder. The earlier
baseline, 77.3 percent (17 of 22), came from the naive offline stand-in, which quotes the line
sharing the most rare words with the question. The same 22 questions also scored 22 of 22 live,
with the ONNX embedder and the model, on 2026-11-25. Raise the baseline only on purpose, with
`eval --write-baseline`. `eval` exits
with 1 when accuracy falls below it, and a test runs the same check, so CI fails on regression.

### Acceptance criteria (each has a test)

- AC-1: files are loaded with stable line numbers, and the chunker keeps each chunk's start and
  end line correct, including blank-line trimming and overlap.
- AC-2: the hashed embedder is deterministic and normalized. The ONNX embedder is only reached
  through an explicit opt-in and is never imported by default.
- AC-3: the Chroma store indexes chunks with a fake embedder and returns the nearest chunks with
  scores, and re-indexing replaces rather than duplicates.
- AC-4: a question whose words are not in the sources is refused before any model call.
- AC-5: a model answer is accepted only when its output validates with pydantic. Invalid output
  retries once, then falls back to an extractive answer of the cited lines, and says so.
- AC-6: a quote that is not verbatim in its chunk is dropped. Line numbers in the citation match
  the file.
- AC-7: a model that says `refused` is honored, and a model that cites nothing falls back.
- AC-8: record and replay serve a recorded response by request hash, and a missing fixture raises.
- AC-9: the Anthropic client sends the key and version headers, takes the model from
  `ANTHROPIC_MODEL`, never echoes a response body in errors, and is tested with an injected
  transport.
- AC-10: the eval set has at least 15 questions including at least 3 refusals, grading is
  correct on hand-built cases, and the committed baseline is met.
- AC-11: the CLI runs `index`, `ask`, `eval` and `metric` offline, deterministically, with the
  right exit codes.
- AC-12: the time to first merged PR metric is computed correctly from the CSV, with bad rows
  rejected.
- AC-13: config rejects unknown keys and bad values.

### How to extend

- A new source type: add its extension to `extensions`. Chunking is by lines, so any text file works.
- A different embedder: implement `Embedder.embed(texts)`. Keep it deterministic if tests use it.
- A different model provider: implement `LlmClient.complete(request)`.
- After changing prompts or the corpus, run `uv run rag-onboarding fixtures` to regenerate the
  offline fixtures, then `eval`, and commit the new baseline on purpose.

### Tests

```bash
pnpm --filter @adl/rag-onboarding coverage   # pytest with a 90 percent line floor
pnpm --filter @adl/rag-onboarding typecheck  # mypy --strict, plus ruff
```

No test downloads a model or uses the network. Chroma telemetry is switched off in code.

### Runtime dependencies

| Package    | Why                                                                         |
| ---------- | --------------------------------------------------------------------------- |
| `chromadb` | Vector store, and the optional ONNX MiniLM embedder used in live mode.      |
| `pydantic` | Validate model output and config.                                           |
| `pyyaml`   | Read `rag.yml`.                                                             |

Dev only: `pytest`, `pytest-cov`, `mypy`, `ruff`. The Anthropic call uses the standard library.
`pnpm` only wraps the commands; the Python project is managed by `uv` (`uv.lock` is committed).
See [ADR 0012](../../docs/decisions/0012-python-for-rag-onboarding.md).

### Security notes

- Only text files under the configured folders are indexed. Do not index folders that hold
  secrets. The agent will quote what it finds.
- Retrieved text is data. The prompt tells the model to ignore instructions inside the excerpts,
  and the citation check means injected text cannot fabricate a quote that is not in a file.
  This does not make prompt injection impossible; it limits what the model's output can claim.
- `ANTHROPIC_API_KEY` is read from the environment only. Error messages carry the HTTP status, not
  the response body.
- The sample data uses invented names. No real credentials appear in any fixture.

### Credit

The refusal pattern (an empty or weak retrieval refuses before the model is called) and the
verbatim citation idea come from the maintainer's MatterBrief project, which applies the same
approach to legal documents with the Claude API's native citations. This piece re-derives the
pattern for file and line citations and verifies quotes itself instead of relying on the API's
citation feature. The hashed bag-of-words embedder follows MatterBrief's `HashEmbedder`.

### Verify before you deploy

Not verified here, because it needs a network, a model download or an API key:

```bash
# 1. ONNX embedder end to end (downloads a model on first use):
cd pieces/11-rag-onboarding && uv run rag-onboarding ask --live "How many approvals does a pull request need?"
# 2. Eval with the ONNX embedder and a live model (22 of 22 on 2026-11-25 without re-tuning min_score):
DEMO_LIVE=1 ANTHROPIC_API_KEY=... uv run rag-onboarding eval --live
```

### Status

Draft for review. The fixtures in `eval/llm-fixtures/` are real `claude-sonnet-5-5` responses,
recorded on 2026-11-25 with `uv run rag-onboarding fixtures --with-model` (the model, with the
offline embedder so they replay in the default mode). The live path (ONNX embedder and Anthropic)
was run end to end the same day: `ask --live` and `eval --live` both worked. Retrieval thresholds are tuned on the 22 sample
questions, so treat the accuracy as a regression guard for this sample, not a quality claim.
The CI workflow installs uv from PyPI at a pinned version instead of using a third-party action,
because no action commit SHA could be checked here. Swap in a SHA-pinned `astral-sh/setup-uv`
if you prefer it.
