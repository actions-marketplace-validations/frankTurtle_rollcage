# Demo script: 05 SBOM and vulnerability triage

Video: "800 CVEs, 6 that matter: AI-assisted vulnerability triage."

Run time: about 1 minute, offline, deterministic. Large terminal font.

```bash
pnpm install
pnpm demo:05:reset   # clean state before every take
pnpm demo:05         # the whole demo end to end
```

The demo reads committed fixtures: SBOMs made by Syft from two small sample apps, a Grype-shaped
scan result, and small synthetic KEV and EPSS snapshots. Say so on camera. The scan has 20
findings, not 800. The ratio is what the demo shows, not the count. Syft and Grype do not run, no
vulnerability database is downloaded, and the model answers come from recorded responses.

## 0:00 to 0:20, the problem

Say: "The scanner found a wall of findings. Which ones do you fix first?" Stat: 84% of developers
use or plan to use AI tools (Stack Overflow 2025; `docs/sources.md`, VERIFY). More generated code
means more dependencies to keep track of.

## 0:20 to 1:00, why it matters

Triage by hand costs analyst hours on every release. Sorting by severity alone puts everything
"High" at the top, and most of it is never exploited. The sort needs three more facts: is a fix
available, is it on the CISA known-exploited list, and how likely is exploitation (EPSS).

## 1:00 to 5:30, screen share

**Before: the raw scan.** Show what the scanner hands you:

```bash
pnpm demo:05 before
```

Prints the SBOM package counts, then every finding in scanner order with its severity. Twenty
lines, mostly "High" and "Critical", no order of work.

**Run: the prioritized table.**

```bash
pnpm demo:05 run
```

Prints the table by tier: 4 in P0, 3 in P1, 6 in P2, 6 in P3, with 1 more waived. Point at P0:
two of the four are on the (synthetic) KEV list. Point at the `code:` line under each finding.
Pillow shows `unknown`: the search found no import, and the tool says so rather than "not
reachable". PyYAML shows `file:line` for the import and for the `yaml.load` call. Below the table
are the short reachability notes for the findings that need a human, each citing only those
`file:line` values.

**After: the leadership note, the SBOM diff and the gate.**

```bash
pnpm demo:05 after
```

Prints the plain-language note for leadership, then what changed between release 1.0.0 and 1.1.0
of the sample app, then the gate: it fails, listing the three findings that stop the build and why
(KEV, or EPSS above 0.1). Say: "Exit code 1. The build stops on three findings, not twenty."

## 5:30 to 6:30, the metric

```bash
pnpm demo:05 metric
```

Prints open criticals, mean time to remediate (from the synthetic history file) and the estimated
analyst triage time, with the minutes-per-finding assumption shown. Say that the triage figure is
an estimate built on an assumption, and that "good" is your own trend.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

Run `pnpm demo:05 before` for five seconds of the raw list, then `pnpm demo:05 run` and hold on
the P0 rows and the evidence column, then the last four lines of `pnpm demo:05 after` (the gate
failing on three findings).

## Live mode

`DEMO_LIVE=1 pnpm demo:05` calls the model for the notes (needs `ANTHROPIC_API_KEY`; the model id
comes from `ANTHROPIC_MODEL`). It still reads the committed scan fixtures. Running Syft and Grype
for real is a separate, opt-in path: see "Verify before you deploy" in the README.

## Reset

`pnpm demo:05:reset` deletes `pieces/05-sbom-vuln-triage/demo/out`.
