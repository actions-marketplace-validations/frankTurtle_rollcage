# 0014. Build the multi-agent workflow on Escapement

Status: accepted (maintainer's decision, 2026-11-25).

Piece 13 needs a headless orchestrator with a deterministic state machine, a context assembler, an
append-only ledger with exact replay, and an eval harness that grades trajectories. Escapement
(`escapement@0.2.0` on npm, the maintainer's library) already provides all four, so the piece
installs it instead of writing a second orchestrator.

What the piece adds around it:

- A `ModelProvider` over the repo's shared `LlmClient`, so tests use `FakeLlm` and recorded replies.
- A `ToolRegistry` built from each agent's frontmatter, so the agent file is the permission list.
- A workflow layer that chains four Escapement runs, because Escapement runs one agent per loop.
- A hash-chained audit entry for every handoff, next to the Escapement ledger.
- The human approval gate, which Escapement does not have.

Consequences: the piece has one runtime dependency with no dependencies of its own. Gaps in the
library that the piece works around are listed in `docs/follow-ups.md`
for the maintainer.
