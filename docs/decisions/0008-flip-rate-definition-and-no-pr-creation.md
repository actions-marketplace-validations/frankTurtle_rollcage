# 0008. Flip rate means same-commit flips, and triage never opens a pull request

Status: accepted, pending maintainer review.

Two choices in piece 07 (CI failure triage) are not obvious.

Flip rate. A test "flips" on a commit when it both failed and passed on that exact SHA. The flip
rate is flip commits over observed commits. Counting changes between consecutive outcomes in time
order would be simpler, but it also counts a real regression and its fix as flips. Same-commit
flips cannot be explained by a code change, so they are evidence of flakiness. The cost is that the
history needs re-runs of the same commit to produce any signal, and a test that fails once and
passes on the next commit looks like a regression.

No pull request. The quarantine proposal is a unified diff and a PR body written to files, plus the
`git apply` and `gh pr create` commands printed as text. The piece has no code path that writes to
GitHub: the GitHub source issues GET requests only, and a test asserts that no other method is
used. Quarantining hides a test from the blocking path, so a person should decide to do it, and
they should do it from their own checkout with their own credentials.

The thresholds (10 observed commits, 3 flip commits, 15 percent) are this tool's own defaults and
are configurable. They are not industry figures.
