# Demo script: 10 Provenance signing

Video: "Prove the artifact you deploy is the one you built."

Run time: about 1 minute, offline, deterministic. Large terminal font. Needs `cosign` and `npm`
on the PATH.

```bash
pnpm install
pnpm demo:10:reset   # clean state before every take
pnpm demo:10         # the whole demo end to end
```

The demo signs with a throwaway key pair that it generates into `demo/out/` (gitignored, empty
password, deleted by reset). It does not use keyless signing and writes nothing to a public
transparency log. Say so on camera. Because the signature never went to a log, the demo verifies
with `--insecure-ignore-tlog`. A real pipeline verifies against the log. The demo shows tamper
detection. It is not SLSA provenance.

## 0:00 to 0:20, the problem

Say: "Your pipeline built a package. How does the deploy step know the file it is about to ship
is that package?" There is no statistic from `docs/sources.md` for this piece. Do not cite one.

## 0:20 to 1:00, why it matters

Review and scanning look at source code. A swapped tarball, a poisoned cache or a file uploaded
by hand skips all of it. The deploy step needs a check that ties the bytes to the build.

## 1:00 to 5:30, screen share

**Before: a deploy step that checks nothing.**

```bash
pnpm demo:10 before
```

Builds a sample npm tarball, makes a copy with one byte changed, and shows that a deploy step that
only checks "does the file exist" accepts both. The digests differ and nothing notices.

**Run: sign the real tarball, verify it, let the gate pass.**

```bash
pnpm demo:10 run
```

Generates the throwaway key, signs the tarball, and runs the deploy gate. Verification passes and
the gate allows the deploy.

**After: tamper one byte, run the gate again.**

```bash
pnpm demo:10 after
```

Flips one byte in the signed tarball. Verification fails, the gate prints BLOCK with the reason,
and exits non-zero. Point at the exit code. A pipeline stops on it.

## 5:30 to 6:30, the metric

```bash
pnpm demo:10 metric
```

Runs the gate over three artifacts: one signed and untouched, one tampered, one unsigned. Prints
"signed and verified: 1 of 3 (33%)". The numbers come from this fixture and are not a
benchmark. Say what 100% would mean: no path to production skips the check.

## 6:30 to 7:00, close

"The template is free in the repo."

## Clip cut (60 to 90 seconds)

`pnpm demo:10 run` followed by `pnpm demo:10 after`: ALLOW, then one changed byte, then BLOCK.

## Reset

`pnpm demo:10:reset` deletes `pieces/10-provenance-signing/demo/out`, including the throwaway
keys.
