"""A scripted stand-in for a model. It generated the committed fixtures.

It is NOT a model. It reads the excerpts in the prompt and quotes the line that shares the most
content words with the question. Fixtures it records are labeled `offline-generator`.
Re-record with a real model by running `fixtures --live`.
"""

import json
import re

from rag_onboarding.llm import LlmRequest, LlmResponse
from rag_onboarding.text import best_lines

_EXCERPT = re.compile(r'<excerpt id="([^"]+)">\n(.*?)\n</excerpt>', re.DOTALL)
_QUESTION = re.compile(r"^Question: (.*)$", re.MULTILINE)


class OfflineLlm:
    def complete(self, request: LlmRequest) -> LlmResponse:
        match = _QUESTION.search(request.prompt)
        question = match.group(1) if match else ""
        flat = [
            (chunk_id, line)
            for chunk_id, text in _EXCERPT.findall(request.prompt)
            for line in text.split("\n")
        ]
        best = best_lines(question, [line for _, line in flat], limit=1)
        payload: dict[str, object]
        if not best:
            payload = {
                "answer": "",
                "citations": [],
                "refused": True,
                "reason": "no excerpt line matches the question",
            }
        else:
            chunk_id, line = flat[best[0]]
            payload = {
                "answer": line.strip(),
                "citations": [{"chunk_id": chunk_id, "quote": line}],
            }
        return LlmResponse(text=json.dumps(payload), model="offline-generator")
