# Demo script: 12 Golden path template

Video: "The minimum viable platform: a golden path template for a new service."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm --filter @adl/golden-path-template demo:reset   # clean state before every take
pnpm --filter @adl/golden-path-template demo         # the whole demo end to end
```

The demo scaffolds into `pieces/12-golden-path-template/demo/out`, links the monorepo's
`node_modules` so the install step needs no network, and never calls GitHub. The percentage in the
metric step comes from two directories the demo creates. Say so on camera.

## 0:00 to 0:20, the problem

Say: "Every new service gets its own CI, its own review rules, and its own idea of secure enough."
Stat reference: none. The "hours lost to tool sprawl" figure in the video hook is not confirmed in
`docs/sources.md`, so it stays out of this demo.

## 0:20 to 1:00, why it matters

Controls that live in a library do not protect a repo that never adopted them. Each team rebuilds
the same pipeline, and the copies drift. A template makes the safe setup the default one.

## 1:00 to 5:30, screen share

Each stage runs alone with `pnpm --filter @adl/golden-path-template demo <stage>`.

**Before: a new repo by hand.** An empty directory has none of the controls.

```bash
pnpm --filter @adl/golden-path-template demo before
```

Prints the golden path check for an empty directory: off the path, with the list of missing files.

**Run: scaffold a service.**

```bash
pnpm --filter @adl/golden-path-template demo run
```

Scaffolds `payments-api` for owner `example-org`, prints the file list and the pin check result,
then scaffolds into the same directory again and shows the refusal.

**After: the pipeline runs.**

```bash
pnpm --filter @adl/golden-path-template demo after
```

Runs install (linked), lint, typecheck, test and build on the generated sample service, and lists
the jobs that need GitHub as skipped: risk gate, secrets scan, SBOM, policy gates, provenance.

## 5:30 to 6:30, the metric

```bash
pnpm --filter @adl/golden-path-template demo metric
```

Prints the share of repos on the golden path across the two demo directories: one scaffolded, one
empty. Time to first deploy comes from GitHub. Show the two `gh api` commands from the README and
say that they were not run.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`demo run`: the scaffold, the file list, the pin check, and the refusal to overwrite.

## Reset

`pnpm --filter @adl/golden-path-template demo:reset` deletes `pieces/12-golden-path-template/demo/out`.
