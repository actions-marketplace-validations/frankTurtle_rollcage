# Integration notes for piece 13

What the orchestrator should add to files this piece was not allowed to edit.

## Root README table row

Replace the existing row 13 with:

```
| 13 | [multi-agent-workflow](pieces/13-multi-agent-workflow/README.md) | Agent changes are hard to review | Every handoff logged, a recorded run replays exactly, and no commit to a shared branch without human approval | % agent changes with a complete trace; rework rate after review | done | TBD |
```

## CHANGELOG bullet

```
- Piece 13 (multi-agent-workflow): planner, implementer, tester and reviewer subagents in
  `.claude/agents/`, and a headless orchestrator built on Escapement 0.2.0 that logs every handoff
  to the run ledger and the hash-chained audit log, replays a recorded run exactly, and blocks
  commits to shared branches until a named human approves the exact change. ADR 0014.
```

## Root `package.json` scripts

```json
"demo:13": "pnpm --filter @adl/multi-agent-workflow demo",
"demo:13:reset": "pnpm --filter @adl/multi-agent-workflow demo:reset",
```

DEMO.md and the workflow file use the filtered form where the root script does not exist yet.

## `docs/video-map.md`

Row 13 status can move from `planned` to built. Demo command: `pnpm demo:13`.

## `docs/sources.md`

Add:

```
## Claude Code subagent file format

- URL: https://code.claude.com/docs/en/sub-agents (read 2026-11-25).
- Used by piece 13: Markdown with YAML frontmatter in `.claude/agents/`; `name` and `description`
  required; optional `tools` (comma-separated or list), `model` (`inherit` allowed).
- Status: re-check before each release; the field list changes.
```

DEMO.md cites the Stack Overflow 84% figure that is already in `docs/sources.md`.

## `.claude/agents/`

This piece created `.claude/agents/{planner,implementer,tester,reviewer}.md`, identical to
`pieces/13-multi-agent-workflow/agents/`. A test fails if they drift. Nothing else under `.claude/`
was touched.

## Not done here

- `evals/baseline.json` was recorded on the feature branch because this suite is new. Escapement's
  own rule is to re-record only on `release/*`. Re-record at the next release if scores move.
- Live mode (`workflow run --live`) is untested. It needs `ANTHROPIC_API_KEY`; the command to try is
  in the README under "Verify before you deploy".
- No real git committer. The shipped one is a dry run.

## Gaps in Escapement 0.2.0, for the maintainer

The piece works around each one with a small adapter. None blocked the build.

1. No multi-agent topology. One `run()` is one agent, so `src/workflow.ts` chains four runs and
   owns the rework loop. A small `handoff` or `pipeline` helper that links ledgers by id would let
   the library carry this.
2. No pause or approval state. The state machine ends in `done`, `failed` or `halted`. The human
   checkpoint sits outside it, in `src/approval.ts`. A `suspended` phase that a run can resume
   from would fit the ledger model.
3. `replay(ledger)` replays the reducer only. It does not re-run tools or the model, so it cannot
   show that a recorded run reproduces end to end. `ledgerProvider` in `src/replay.ts` serves the
   recorded model turns back; a library-level `replayProvider(ledger)` would remove that code.
4. `EvalCase` takes scripted turns and real tool definitions. Building a case from a recorded
   ledger needed two helpers here (`scriptFor`, `recordedTools` in `src/eval-cases.ts`). A
   `caseFromLedger(ledger, graders)` would cover both.
5. `scriptedProvider` makes its own tool call ids (`call-01-01`), so a script cannot reproduce a
   ledger recorded from another provider byte for byte. The piece's `ledgerProvider` returns the
   recorded messages unchanged for that reason.
6. The package is typed with `readonly` everywhere and its handlers take `JsonObject`, so tool
   handlers need casts on `args` values. A typed `tool()` overload with a schema-derived argument
   type would help.
7. `ModelProvider` assumes native tool calls. The repo's shared `LlmClient` returns text, so the
   adapter defines a JSON turn format. Adopters with the same constraint would reuse it.
