# Integration notes for the orchestrator

Files outside `pieces/05-sbom-vuln-triage/` that need an edit. None of these were touched.

## Root `package.json` scripts

```json
"demo:05": "pnpm --filter @adl/sbom-vuln-triage demo",
"demo:05:reset": "pnpm --filter @adl/sbom-vuln-triage demo:reset"
```

Stages work as `pnpm demo:05 before|run|after|metric`, as in piece 03.

## Root README table row

| 05 SBOM and vulnerability triage | Syft SBOMs and Grype scans turned into a prioritized list (severity, fix, KEV, EPSS), code evidence with `file:line`, a leadership note, an SBOM diff between releases, and a CI gate. | `pieces/05-sbom-vuln-triage` |

## CHANGELOG bullet

- feat(sbom-vuln-triage): prioritized vulnerability triage from Syft and Grype output, with KEV and EPSS ranking, grep-based reachability evidence ("unknown" when there is none), a leadership note, an SBOM diff, and a composite GitHub Action gate (`pieces/05-sbom-vuln-triage/action.yml`, inputs `path` and `fail-on`).

## `docs/sources.md`

No new entry. The demo cites the Stack Overflow 84% figure that is already listed. The piece cites no other statistic. If you want a source entry for the feeds, the two URLs used with `--live-feeds` are the CISA KEV JSON
(`https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json`) and the FIRST EPSS API
(`https://api.first.org/data/v1/epss`). Neither response shape was checked against the live service.

## `docs/video-map.md`

Piece 05 demo command: `pnpm demo:05`. Video: "800 CVEs, 6 that matter: AI-assisted vulnerability triage."

## Contract for piece 12

`pieces/05-sbom-vuln-triage/action.yml` is a composite action with inputs `path` (default `.`) and `fail-on` (default `critical`), plus `epss-threshold`, `waivers` and `live-feeds`. It expects `syft` and `grype` on `PATH` (an earlier, SHA-pinned install step) and fails with a clear message if they are missing. It exits 1 when an unresolved finding at or above `fail-on` is in KEV or above the EPSS threshold.

## Shared helpers I wished existed

- A shared `Runner` (spawn with a fixed argument list, injectable for tests). Kept locally in `src/live.ts`.
- A shared date helper for `YYYY-MM-DD` day differences (`daysBetween`, in `src/types.ts`).
- A way to mark a path as sample code for ESLint. The sample app sources under `demo/apps` are written as ES modules with no Node globals only to pass the repo-wide lint config.
