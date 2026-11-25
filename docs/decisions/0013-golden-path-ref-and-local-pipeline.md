# 0013. Golden path: one rollcage ref, and a local pipeline that links node_modules

Status: accepted, pending maintainer review.

## One ref for every rollcage piece

The generated workflows call pieces 01, 05, 06 and 10 as `frankTurtle/rollcage/pieces/<piece>@<ref>`.
All of them use one token, `__ROLLCAGE_REF__`, filled from `--ref`. The default is the tag `v0.1.0`.

A tag can move, so it is weaker than a commit SHA. The scaffold accepts a SHA, prints a warning when
the ref is not one, and shows the `git ls-remote` command that resolves it. Third-party actions are
always SHA pinned, and the scaffold refuses to generate a project in which one is not. The default
stays a tag because a SHA that does not exist yet cannot be written into a template, and pieces 05,
06 and 10 are not in the `v0.1.0` release at the time of writing. The README says the ref must
point to a release that contains them.

## The local pipeline links node_modules

The CI test scaffolds a project into a temp directory and runs install, lint, typecheck, test and
build. A real `pnpm install` would call the npm registry, and tests here make no network calls. The
generated `package.json` uses the same dev dependency ranges as this monorepo, so the test symlinks
the monorepo's `node_modules` into the temp project. The install step then shows as a link, not a
download.

This proves the generated sources and configs work with the toolchain this repo already
resolves. It does not prove that `pnpm install` resolves the generated `package.json`. Run
`scaffold pipeline <dir>` without `--link-modules` once to check that.

The script steps run through `npm run`, not `pnpm run`, so that a pnpm version that differs from the
`packageManager` field does not try to download another pnpm.
