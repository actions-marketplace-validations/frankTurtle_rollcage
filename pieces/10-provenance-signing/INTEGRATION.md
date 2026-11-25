# Integration notes for the orchestrator (piece 10)

Files this piece could not edit, and what to put in them.

## Root `package.json` scripts

```json
"demo:10": "pnpm --filter @adl/provenance-signing demo",
"demo:10:reset": "pnpm --filter @adl/provenance-signing demo:reset"
```

The demo needs `cosign` and `npm` on the PATH. It makes no network calls.

## Root `README.md` table row

| 10 | [Provenance signing](pieces/10-provenance-signing) | Deploy gate that blocks any artifact it cannot verify against a signature or build attestation, plus a sample attestation workflow (disabled until the maintainer approves it). | "Prove the artifact you deploy is the one you built." |

## `CHANGELOG.md` bullet

- Add piece 10, provenance signing: a deploy-gate CLI (cosign key, cosign keyless and
  `gh attestation verify` modes, fails closed), a metric for the share of artifacts signed and
  verified, a composite action (`artifact`, `mode: verify|attest`) for the golden path, and an
  offline demo that signs, tampers and blocks.

## `docs/sources.md`

No statistics are cited. Suggested reference entries (specification pages, not statistics):

- SLSA specification v1.0, build track levels: https://slsa.dev/spec/v1.0/levels
- GitHub documentation on artifact attestations and SLSA build levels (Build 2 with a single
  workflow, Build 3 with a reusable workflow): https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations
- Status: VERIFY BEFORE PUBLISHING. The README's level claims come from these pages as remembered
  by the author of this piece. They were not fetched during the build.

## `docs/video-map.md`

Piece 10 video: "Prove the artifact you deploy is the one you built." Demo command `pnpm demo:10`,
about 1 minute, clip cut is `run` then `after` (ALLOW, one changed byte, BLOCK).

## Piece 12 contract

`pieces/10-provenance-signing/action.yml` is a composite action. Inputs: `artifact` (required,
path), `mode` (`verify` default, or `attest`). Extras with defaults: `repo`, `signer-workflow`,
`bundle`, `github-token`. For `attest` the calling job needs `id-token: write`,
`attestations: write`, `contents: read`. For `verify`, `contents: read`.

## Items that need the maintainer's OK

- Enabling the `attest-sample` job (writes a public Sigstore entry with the repository identity).
- Pinned SHAs for `actions/attest-build-provenance` (v4.2.2) and `sigstore/cosign-installer`
  (v4.1.4) were read with an anonymous `git ls-remote` against the public repositories. No GitHub
  API call and no authentication.
- Confirming `gh attestation verify --format json` output matches what the gate parses.

## Shared helper wishlist

A `CommandRunner` type and an `execFile` wrapper with timeout would suit `shared/ts`. Local copy in `src/runner.ts` and `src/types.ts`.
