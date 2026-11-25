# 0006. SBOM triage: hand-authored scan fixture, stand-in recordings, no "not reachable"

Status: accepted, pending maintainer review.

Three choices in piece 05 are not obvious from the code.

Grype output is hand-authored. No Grype vulnerability database was installed when the piece was
built, and tests and the default demo must not download one. The Syft SBOMs in `fixtures/` are real
Syft 1.57 output for the two sample apps (serial number and timestamp normalized). The Grype JSON
is written by hand in Grype's JSON shape, with illustrative severities and fix versions, and says
so in a `_fixtureNote` field. The README lists the commands that confirm the parser against real
Grype output before the Action is relied on.

The "recorded" model responses are scripted. `demo/record-llm.ts` writes `fixtures/llm/` using a
stand-in client that builds replies from the prompt data, stored under the prompt hash by the
shared `RecordReplayLlm`. They are not output from a real model. This keeps the default demo
offline and deterministic. A prompt change makes the recordings stale, and a test fails until the
script is run again.

There is no "not reachable" verdict. Reachability is a text search for imports and advisory
function names. Without a call graph, no match cannot be told apart from a match the search missed
(dynamic imports, aliases, transitive use), so the only honest result is `unknown`. Model notes are
also rejected when they cite a location outside the evidence or claim a package is not reachable.
