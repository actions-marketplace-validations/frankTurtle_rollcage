# 0015. The AI tool eval stores no vendor facts

Status: accepted, pending maintainer review.

Piece 14 scores AI coding tools against a rubric. The example scorecard uses placeholder tools
(Tool A, B and C), and the repository states no vendor fact. The vendor terms and plans these tools
change often, and an agent in this repository cannot read every vendor's documents in a session.
A table of facts with a date read would go stale, and a wrong one would look authoritative.

So the rubric asks the reader to read each vendor's own documents and record the URL and the date
read in their own copy of the scorecard. The scorecard in this repository carries no such fields.
If a later change adds a vendor facts table, every row needs the document URL, the date read, and a
VERIFY flag, and a cell the author did not read must say "not checked" rather than guess.

The weights live in `pieces/14-ai-dev-tool-eval/weights.json`, with gate flags for training use
and audit export. A tool that scores 0 on a gate ranks below every tool that passes it. The gate
choice is a policy decision made in code so that a high total cannot hide a failed gate.

Limit: the weights and gates encode one set of priorities. They are defaults, not a standard.
