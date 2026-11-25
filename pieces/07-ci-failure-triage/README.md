# 07 CI failure triage

A CLI and a GitHub Action that read failed workflow runs, work out whether the failure is a code
regression, a flaky test, an infrastructure problem or a dependency problem, and write a short
summary with a suggested next step. For flaky tests it also drafts a quarantine-list change as a
patch and a pull request body for a human to review.

## For engineering leaders

The problem. A red build is ambiguous. Someone has to open the logs to find out whether the code
broke or the pipeline did, and the usual answer is to click "re-run" and hope. Reruns cost
engineer attention and runner minutes, and they teach the team to ignore red builds, including the
real ones.

What this proves.

- Every failed run gets a category, the evidence lines behind it, and a confidence level, decided
  by rules in code and by run history. The model does not choose the category.
- Each test gets a flip rate: how often it both
  failed and passed on the same commit.
- A test that crosses your thresholds gets a quarantine proposal (a patch and a PR body). A
  person reviews and merges it. The tool never merges anything and, in this piece, never opens the
  pull request itself.
- The summary and next step come from the model with an assumptions list, and fall back to a fixed
  text per category if the model output is invalid or the model is unavailable.

The metric. Three numbers, computed from run records and printed before and after a date you
choose:

| Metric             | How this tool measures it                                                                                   | Better is |
| ------------------ | ----------------------------------------------------------------------------------------------------------- | --------- |
| Time to green      | Hours from a failed run to the next successful run of the same workflow on the same branch. Median and p90. | lower     |
| Flaky failure rate | Share of failed runs whose commit later passed the same workflow with no code change (same SHA).            | lower     |
| Reruns per week    | Workflow run attempts beyond the first, per week.                                                           | lower     |

What "good" looks like. There are no industry bands here and this tool does not invent any. Good is
your own trend after quarantining and fixing the flaky tests it names: fewer reruns, a lower flaky
failure rate, a shorter time to green, judged on enough samples. Small samples are flagged.

Adopt it in a week.

1. Day 1: run `triage` on a folder of logs from your last few red builds and read the categories
   against what you already know.
2. Day 2: export 30 days of runs with `--repo` (needs a token with read access to Actions) and
   seed the flip history with `--update-history`.
3. Day 3: tune `triage.yml` thresholds with your team, then review the first quarantine proposal.
4. Day 4: schedule the Action and attach the summary to failed runs as an artifact.
5. Day 5: run `metrics --compare-at <date>` and share the before and after.

Limits.

- Classification is heuristic. A category is a reading of the log and the history, not a confirmed
  root cause. The output says so, and the evidence lines are there so you can check it.
- The patterns cover common npm, pnpm, pip, Go, Jest, Vitest and pytest output. A message it does
  not know falls through to "regression" with low confidence, or "unknown" when there is no error
  text at all.
- The flip rate needs history. A new test has none, so it is never proposed for quarantine on
  history alone. A same-commit pass after a failure still marks that one failure as flaky.
- Quarantining hides a test from the blocking path. It keeps the team moving while someone fixes
  the test. The proposal leaves the owner field blank on purpose.
- Passing runs only add history for tests this tool has already seen fail. Tests that never fail
  do not appear.
- The GitHub path is verified against recorded response shapes only. See "Verify before you
  deploy".
- The flaky failure rate counts any failed run whose commit later passed, so an infrastructure
  blip that clears on re-run is included. The category breakdown in `triage.md` separates them
  when logs are available.
- The time to green uses each run's last update time as its finish time when it comes from the
  GitHub API, so it is approximate.
- One repository at a time. No per-team view.

## For engineers

### Architecture

```mermaid
flowchart LR
  G[GitHub runs and job logs via GitHubHttp] --> R[RunRecord list + log text]
  L[Local runs.json + log files] --> R
  R --> S[extractSignature: normalize, hash]
  S --> C[classify: rules + history]
  H[(history.json flip rates)] --> C
  C --> M[summarize: LLM, structured, fallback]
  C --> Q[proposeQuarantine: patch + PR body]
  H --> Q
  R --> X[metrics: before / after]
  M --> O[triage.md, triage.json]
  Q --> O
```

- `signature.ts` strips ANSI codes, timestamps, workspace and home paths, commit SHAs, UUIDs, IPs,
  durations, long numbers and line and column numbers, then keeps up to three distinct error
  lines. The signature is that text and its hash is a 12 character SHA-256 prefix. It also pulls
  failing test ids from Vitest, Jest, pytest and Go output.
- `classify.ts` runs ordered rules. Dependency rules come first (registry, resolution, lockfile),
  then infrastructure rules (runner, network, rate limit, out of memory, disk), then flaky checks
  (same-commit retry pass, flip rate over threshold), then regression as the default. The first
  category that matches wins and every match is listed as evidence.
- `history.ts` keeps `history.json`: per test, a list of observations `{runId, sha, outcome, at}`.
  The flip rate is the share of observed commits where the test both failed and passed. Recording
  a run twice does not double count.
- `quarantine.ts` turns tests over the thresholds into an edited `quarantine.json`, a unified diff
  and a PR body. It only produces text. There is no code path in this piece that creates a pull
  request.
- `summarize.ts` asks the model for `{summary, next_step, assumptions}` through the shared
  `completeStructured` helper. Secrets in the log excerpt are redacted before the prompt is built.
  The category is passed in and cannot be changed by the reply.
- `metrics.ts` computes the three numbers from run records.
- `github-source.ts` lists runs, fetches earlier attempts of re-run runs, and downloads job logs
  through the shared `GitHubHttp`.

### Install and run

```bash
pnpm install
# Classify the fixture failures offline, with recorded model replies:
pnpm --filter @adl/ci-failure-triage exec tsx src/bin.ts triage \
  --runs fixtures/runs.json --history fixtures/history.json \
  --quarantine fixtures/quarantine.json --llm replay --llm-fixtures demo/llm-fixtures --out out

# Classify local log files with no run records:
pnpm --filter @adl/ci-failure-triage exec tsx src/bin.ts triage --log build.log --llm none

# From GitHub (reads only):
GITHUB_TOKEN=... pnpm --filter @adl/ci-failure-triage exec tsx src/bin.ts triage \
  --repo OWNER/NAME --since 2026-03-01 --until 2026-03-29 --history history.json

# Metrics before and after a date:
pnpm --filter @adl/ci-failure-triage exec tsx src/bin.ts metrics \
  --runs fixtures/runs.json --compare-at 2026-03-02
```

Flags for `triage`: `--runs FILE`, `--repo OWNER/NAME` with `--since` and `--until` (UTC dates),
`--log FILE` (repeatable), `--history FILE`, `--update-history`, `--quarantine FILE`,
`--config FILE`, `--llm auto|live|replay|none`, `--llm-fixtures DIR`, `--out DIR`.
`--llm auto` uses the live model only when `ANTHROPIC_API_KEY` is set; otherwise it uses the
fixed fallback text. The model id comes from `ANTHROPIC_MODEL` through the shared config.

### GitHub Action

`action.yml` runs `triage --repo` for the current repository, appends `triage.md` to the job
summary and uploads the report as an artifact. Inputs: `days`, `history`, `update-history`,
`quarantine`, `config`, `llm` (default `none`), `anthropic-api-key`, `github-token`. See
`examples/ci-triage-weekly.yml`. It needs `actions: read` only.

### Config reference (`triage.yml`)

```yaml
flaky:
  min_observations: 10 # commits the test must have been seen on before history can mark it flaky
  min_flip_commits: 3 # commits where it both failed and passed
  flip_rate_threshold: 0.15 # flip commits / observed commits
log:
  max_error_lines: 3 # distinct error lines kept in a signature
  excerpt_lines: 12 # lines of context sent to the model, after redaction
min_samples: 5 # metrics below this many failed runs are flagged as small samples
```

These defaults are this tool's own choices, not industry figures.

### Quarantine proposal

`triage` writes `quarantine.patch` and `quarantine-pr-body.md` for each test over the thresholds
and not already listed. A maintainer reviews the patch and, if they agree, applies it and opens
the pull request themselves:

```bash
git switch -c chore/quarantine-flaky-tests
git apply out/quarantine.patch
git add quarantine.json
git commit -m "chore(ci): quarantine flaky tests"
gh pr create --title "Quarantine flaky tests" --body-file out/quarantine-pr-body.md
```

Nothing in this piece runs those commands. Your test runner has to read `quarantine.json` and
skip or run the listed tests without blocking. Wiring that is specific to each framework and is
not included.

### Extend

- New category rule: add an entry to `RULES` in `src/classify.ts` with an id, a category, a
  pattern and a one-line description, and add a fixture log and a test.
- New test-id format: add a pattern to `TEST_PATTERNS` in `src/signature.ts`.
- Other CI systems: implement `RunSource` (`listRuns`, `failureLog`) and pass it to the CLI loader.

### Tests

```bash
pnpm --filter @adl/ci-failure-triage test
pnpm --filter @adl/ci-failure-triage coverage   # floor: 90% lines
```

Tests use committed fixture logs and a fake `fetch`. No test touches the network.

### Runtime dependencies

- `@adl/shared`: LLM interface, structured output, GitHub transport, YAML config, demo helpers.
- `zod`: validates the history file, the config and the model reply.
- `tsx`: runs the TypeScript CLI and demo without a build step.

### Security notes

- Logs can contain secrets. Known token shapes (AWS access key ids, GitHub tokens, bearer headers,
  `key=value` secrets) are redacted before any text goes into a prompt, a patch or a summary.
  Redaction is pattern based and will miss unusual formats, so treat logs as sensitive.
- The GitHub token is read from the environment, sent only to the GitHub API, and never printed.
  The workflow asks for `actions: read` and nothing else.
- Fixtures use obviously fake values, such as the AWS documentation example key
  `AKIAIOSFODNN7EXAMPLE`.
- The tool reads and writes files and prints text. It cannot merge, approve, re-run or cancel a
  workflow.

### Verify before you deploy

This piece was built and tested against recorded response shapes, not a live repository. Before
you rely on the GitHub path, run one read-only check with your own token against a repository you
own:

```bash
GITHUB_TOKEN=$(gh auth token) pnpm --filter @adl/ci-failure-triage exec tsx src/bin.ts triage \
  --repo OWNER/NAME --since 2026-03-01 --until 2026-03-08 --llm none --out out-live
```

Check that `out-live/triage.md` lists the failed runs you expect and that job logs were found. The
endpoints used are: list workflow runs, get a workflow run attempt, list jobs for a workflow run
attempt, and download job logs for a workflow run (all in GitHub's REST reference). Log downloads
answer with a redirect to a short-lived URL; confirm your environment follows it.
