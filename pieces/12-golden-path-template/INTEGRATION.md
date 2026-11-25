# Integration notes for the orchestrator

Piece 12, `@adl/golden-path-template`. Add these to the files this piece may not edit.

## Root README table row

| 12 Golden path template | Every new service re-creates its own CI and review rules, and the copies drift. | A template and `scaffold` CLI that start a repo with the library's controls wired in, SHA-pinned. | Time from new repo to first prod deploy; share of repos on the golden path | MVP | video link placeholder |

Match the column order of the existing rows. The status is "done" once pieces 05, 06 and 10 exist in the ref the template points to.

## CHANGELOG bullet

- Add the golden path template (piece 12): a TypeScript service template with reusable workflows for pieces 01, 04, 05, 06 and 10, plus a `scaffold` CLI that refuses non-empty directories and pins every action by SHA.

## Root package.json scripts

```json
"demo:12": "pnpm --filter @adl/golden-path-template demo",
"demo:12:reset": "pnpm --filter @adl/golden-path-template demo:reset"
```

After adding them, DEMO.md can use `pnpm demo:12` in place of the filter form.

## docs/sources.md

No entry. This piece cites no statistic. The "7 hours a week" figure from the video hook is left out because it is not confirmed there.

## docs/video-map.md

Piece 12 row: hook "The minimum viable platform" (without the unverified hours figure), demo `pnpm demo:12`.

## Shared helpers

None needed. The piece uses Node built-ins only.

## Things to check when pieces 05, 06 and 10 land

- Their `action.yml` input names must match: 05 `path`, `fail-on`; 06 `path`, `policy`; 10 `artifact`, `mode`. If they differ, edit `template/.github/workflows/{sbom-vuln,policy-gates,provenance}.yml` and the table in this README.
- Tag a release that contains them and use it as the default `DEFAULT_REF` in `src/scaffold.ts` (currently `v0.1.0`, which does not contain them).
- The generated `docs/branch-protection.md` lists check names in `caller / called` form. Confirm them on a real pull request, as the doc says.
