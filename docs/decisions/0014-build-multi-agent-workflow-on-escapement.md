# 0014. Build the multi-agent workflow on Escapement

Status: accepted (maintainer's decision, 2026-11-25).

Piece 13 needs a headless orchestrator with a deterministic state machine, a context assembler, an
append-only ledger with exact replay, and an eval harness that grades trajectories. Escapement
(`escapement` on npm, the maintainer's library; 0.2.0 at the time, 0.3.0 now) already provides all four, so the piece
installs it instead of writing a second orchestrator.

What the piece adds around it:

- A `TextModel` over the repo's shared `LlmClient`, wrapped by Escapement's `textProvider`, so tests use `FakeLlm` and recorded replies.
- A `ToolRegistry` built from each agent's frontmatter, so the agent file is the permission list.
- A workflow layer that routes four agents through Escapement's `pipeline()`. On 0.2.0 it chained four runs by hand, because Escapement ran one agent per loop.
- A hash-chained audit entry for every handoff, next to the Escapement ledger.
- The human approval gate over the whole change set. Escapement 0.3.0 can suspend a run for a tool call that needs approval, but this gate approves a change hash for the orchestrator's commit, and no agent holds a commit tool, so it stays outside the library.

Consequences: the piece has one runtime dependency with no dependencies of its own. Gaps in the
library that the piece works around are listed in `docs/follow-ups.md`
for the maintainer.
