# **NAME**

Generated from the rollcage golden path template. Owner: @**OWNER**.

## First steps

```bash
pnpm install                 # creates pnpm-lock.yaml: commit it, CI installs with --frozen-lockfile
pre-commit install --hook-type pre-commit --hook-type commit-msg
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Then:

1. Push to GitHub and open a first pull request so the checks run once.
2. Apply the settings in [docs/branch-protection.md](docs/branch-protection.md).
3. Enable private vulnerability reporting, so [SECURITY.md](SECURITY.md) has a working contact.

## What the pipeline does

`.github/workflows/ci.yml` calls these reusable workflows:

| Workflow           | Job in ci.yml | What it runs                                         |
| ------------------ | ------------- | ---------------------------------------------------- |
| `build-test.yml`   | `build-test`  | install, lint, typecheck, tests with coverage, build |
| `gate-pr-risk.yml` | `risk-gate`   | rollcage piece 01, pull requests only                |
| `secrets-scan.yml` | `secrets`     | gitleaks on the diff, and full history on a schedule |
| `sbom-vuln.yml`    | `sbom`        | rollcage piece 05                                    |
| `policy-gates.yml` | `policy`      | rollcage piece 06                                    |
| `provenance.yml`   | `provenance`  | rollcage piece 10, verify mode                       |

Pieces 01, 05, 06 and 10 are referenced as `frankTurtle/rollcage/pieces/<piece>@__ROLLCAGE_REF__`.
That ref must contain those pieces. To pin it by commit SHA:

```bash
git ls-remote https://github.com/frankTurtle/rollcage refs/tags/__ROLLCAGE_REF__
```

Replace the ref in `.github/workflows/` and `.golden-path.json` with the SHA. Dependabot keeps the
third-party action SHAs current.

## Sample service

`src/handler.ts` is a pure request handler, `src/main.ts` serves it on `PORT` (default 3000).
Replace it with your service.
