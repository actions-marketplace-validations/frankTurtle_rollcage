# Live proof report

Run on 2026-11-25 on a Mac, from branch `feature/live-proofs`. Tools: syft 1.57.2, grype 0.122.1
(DB v6.1.10, built 2026-11-25), Terraform 1.14.4 (AWS provider 6.x), conftest 0.71.1, `gh`, uv,
model `claude-sonnet-5-5`. The Anthropic key came from the environment and was never printed or
written anywhere.

Not run, on purpose: the provenance and attestation workflow, `terraform apply` (nothing was
applied or created in AWS), any change to a GitHub repository setting, tags, releases, merges.

## Summary

| Piece | Result |
| ----- | ------ |
| 05 | Proven live (syft, grype, KEV and EPSS). Real output now pinned as fixtures. Two bugs fixed. The composite action itself was not run on a GitHub runner. |
| 06 | Proven against real `terraform show -json` plans. Found and fixed a real rule bug (PG002). Live explain proven. |
| 07 | Proven against real runs and job logs of `rollcage-example`. One bug fixed. |
| 08 | Live Cost Explorer: not run. Live model summary proven, one bug fixed. |
| 09 | Live model draft proven. |
| 11 | ONNX embedder and live Anthropic proven. Eval 22 of 22 live. Fixtures re-recorded from the real model. |
| 12 | `pnpm install` and checks proven on a generated project. Branch-protection payload verified without applying. One template bug fixed. |
| 13 | `--live` proven end to end. The model's turn format is the weak point, see below. |

## Piece 05: SBOM and vulnerability triage

Commands:

```bash
syft dir:pieces/05-sbom-vuln-triage/demo/apps/node-app -q -o cyclonedx-json > sbom.json
grype sbom:sbom.json -q -o json > grype.json
cd pieces/05-sbom-vuln-triage
pnpm exec tsx src/bin.ts gate --live --live-feeds --path demo/apps/node-app --fail-on critical
pnpm exec tsx src/bin.ts gate --live --path <rollcage-example clone> --fail-on critical
pnpm exec tsx src/bin.ts report --app shop-api:<real grype json>:demo/apps/node-app --llm-live
```

- Proven live: the piece's `--live` path ran syft then grype and triaged the result. The real
  Grype JSON has the shape the parser expects (including the CVE in `relatedVulnerabilities` for
  GHSA matches), so the hand-authored fixture was right and the parser needed no change. A scan of
  `rollcage-example` found 8 findings (2 Critical in `tinypool`); the demo app found 41.
- New fixtures: `fixtures/live-shape/grype-real-2026-11-25.json` (trimmed) and
  `syft-real-2026-11-25.cdx.json` (CycloneDX 1.7), with tests in `tests/live-shape.test.ts`.
- Fixed: the table ran a long package name into the next column (`@vitest/mocker 3.2.7Medium`).
- Fixed: the live reachability notes call asked for 2000 tokens, which cut the JSON off mid-string
  on a real scan, so the piece fell back to the template. It now scales with the finding count.
- Not proven: the composite `action.yml` on a GitHub runner. `rollcage-example`'s `sbom-vuln.yml`
  is `workflow_call` only, so it cannot be started by hand. The action's last step is the command
  above, which did run.
- Observed, not changed: the leadership note's model text once garbled a version
  (`0.4.17.19`). The structural checks passed; only a human read catches that.

## Piece 06: policy gates

Commands (Terraform plan only, fake credentials, no AWS call):

```bash
cd pieces/06-policy-gates/examples/terraform/real/violations   # and .../fixed
terraform init && terraform plan -out=tfplan && terraform show -json tfplan > plan.json
conftest test -p policies/terraform --all-namespaces plan.json
pnpm exec tsx src/bin.ts check examples/terraform/plan-real-violations.json --explain --live
```

- Proven: the violating config fails PG001, PG002 (twice) and PG003 (twice), the same five as the
  hand-written plan. New fixtures: `examples/terraform/plan-real-violations.json` and
  `plan-real-fixed.json`, with the configs that produced them under `examples/terraform/real/`.
- Found and fixed a real bug: the fixed config failed PG002. When an encryption resource points at
  its bucket (`bucket = aws_s3_bucket.assets.id`), the real plan leaves `after.bucket` unknown, so
  the rule's literal-name match never found it. PG002 now also matches by the reference recorded in
  the plan's `configuration`. Two Rego tests added; Rego coverage stays 100%.
- Live explain (`--explain --live`) worked for all five violations with validated output.
- Limit: only root-module references are followed. A bucket in a child module is matched by name.

## Piece 07: CI failure triage

```bash
GITHUB_TOKEN=$(gh auth token) pnpm exec tsx src/bin.ts triage --repo frankTurtle/rollcage-example \
  --since 2026-11-25 --until 2026-11-26 --llm none --out <dir>
gh api --allow-escape-sequences repos/frankTurtle/rollcage-example/actions/jobs/<id>/logs
```

- Proven: runs were listed, the log redirect was followed, a real log was found and triaged.
  For three completed runs, `updated_at` was within one second after the last job's `completed_at`,
  so it is a good finish time for completed runs.
- Fixed: real logs start with a byte order mark, which hid the first timestamp. New fixture
  `fixtures/logs/real-dependabot-job.log` (head and tail of a real log) and a test.
- Observed: the one failed run was a Dependabot job, not CI. The rules called it a network error
  from a proxy warning in the log; the real cause was an update that could not be made. The README
  now says to filter Dependabot runs out. Not changed in code.

## Piece 08: AWS cost explainer

- Live Cost Explorer: not run. The configured profiles are deploy profiles and the account root;
  none is a scoped read-only cost profile. Still unproven: the Cost Explorer request shapes and
  whether `ce:*` can be scoped below `*`.
- Live model summary (fixture data, `DEMO_LIVE=1 ... report`): worked, after a fix. The call asked
  for 800 tokens and the reply was cut off mid-string, so the deterministic summary was used. It
  now asks for 2000. After the fix 5 of 6 runs used the model (one fell back to the deterministic
  text, which is the designed safe behavior).

## Piece 09: postmortem drafter

`pnpm exec tsx src/bin.ts draft --bundle demo/out/bundle --live --out <dir>`: wrote a draft with
source `model`; 17 values were redacted before the call. The draft kept the timeline from code,
labeled causes as hypotheses with evidence ids, and said what it did not know.

## Piece 11: RAG onboarding

```bash
uv run rag-onboarding ask --live "How many approvals does a pull request need?"   # ONNX + Anthropic
DEMO_LIVE=1 uv run rag-onboarding eval --live                                       # 22 of 22
uv run rag-onboarding fixtures --with-model                                         # new flag
uv run rag-onboarding eval --write-baseline
```

- Proven: the ONNX embedder (model downloaded on first use) and the live Anthropic path work.
  `eval --live` scored **22 of 22 (100%)** with no `min_score` re-tuning, against the earlier
  scripted 77.3% (17 of 22).
- Added `fixtures --with-model`: records real model responses but retrieves with the offline
  embedder, so the fixtures replay in the default mode. The 16 fixtures in `eval/llm-fixtures/` are
  now real `claude-sonnet-5-5` output (they said `offline-generator` before). Replay eval is also
  22 of 22, and `eval/baseline.json` is raised to 1.0 on purpose. The test that re-records with
  the offline generator now grades against its own 0.77 floor.
- Caveat: 22 sample questions, and the same set the thresholds were tuned on. It is a regression
  guard, not a quality claim. The offline run is what CI uses.

## Piece 12: golden path template

```bash
pnpm exec tsx src/bin.ts scaffold <dir> --name payments-api --owner frankTurtle --ref v0.3.0
cd <dir> && pnpm install && pnpm lint typecheck test build coverage format:check
pnpm exec tsx src/bin.ts pipeline <dir>      # real pnpm install
```

- Proven: real `pnpm install`, lint, typecheck, test, build and coverage (100%) pass. `pipeline`
  passes with the five GitHub-only jobs skipped. `check` reports 100% on the golden path.
- Fixed: the generated `format:check` failed on `README.md` and `docs/branch-protection.md`
  (unaligned tables). Template files reformatted. The generated CI does not run `format:check`, so
  only the local script was affected.
- Branch protection, not applied: the `gh api` payload was extracted from the generated guide and
  compared with GitHub's published REST schema for `PUT .../branches/{branch}/protection`. All four
  required top-level fields are present, there are no unknown fields, and `contexts` is allowed
  (deprecated). The check names match what real runs on `rollcage-example` report. `main` there has
  no protection today (a read-only GET returned 404).

## Piece 13: multi-agent workflow

`pnpm exec tsx src/bin.ts run --live --task ... --out <dir>` (after `pnpm install`, because
`node_modules` still had Escapement 0.2.0 while `package.json` pins 0.3.0).

- Run 1 (task "Add a --json flag"): the planner correctly found the fixture repo has no CLI and
  recommended clarifying; the implementer made no change, so the run halted. Safe behavior.
- Run 2 (a task that fits the fixture repo): halted at the reviewer, after repeated
  `model.invalid_turn` ("no JSON object found").
- Run 3 (same task): completed, reviewer approved, status `awaiting-approval`, nothing committed.
  The reviewer noted the test tool only scans for FIXME markers, so it could not claim the tests ran.
- Finding for Escapement, not fixed here: the model often prefixes its JSON turn with pseudo
  tool-call markup (`<invoke ...>`) or wraps it in a code fence, and sometimes replies with no
  JSON at all. The repair turns usually recover; they ran out in run 2. A more tolerant turn parser
  or native tool calls would remove this. 1 of 3 runs halted for this reason.
- Not exercised: `approve` and `commit` on a live run (the committer is a dry run).

## Still unproven

- Piece 05: the composite action on a GitHub runner.
- Piece 08: live Cost Explorer.
- Piece 10: unchanged (needs the attestation run, which was off limits).
- Piece 13: `approve` and `commit` after a live run.
