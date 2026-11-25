"""AC-5 helper behavior: structured output, and the offline generator that made the fixtures."""

import json

import pytest
from pydantic import BaseModel

from rag_onboarding.llm import FakeLlm, LlmRequest
from rag_onboarding.offline_llm import OfflineLlm
from rag_onboarding.structured import complete_structured, extract_json


class Thing(BaseModel):
    n: int


def test_extract_json_handles_fences() -> None:
    assert extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert extract_json(' {"a": 2} ') == {"a": 2}
    with pytest.raises(json.JSONDecodeError):
        extract_json("nope")


def test_structured_first_try() -> None:
    llm = FakeLlm(['{"n": 1}'])
    r = complete_structured(llm, LlmRequest(prompt="p"), Thing, lambda: Thing(n=0))
    assert (r.value.n, r.source, r.attempts) == (1, "model", 1)


def test_structured_retry_then_fallback_with_reason() -> None:
    llm = FakeLlm(['{"n": "x"}', "garbage"])
    r = complete_structured(llm, LlmRequest(prompt="p"), Thing, lambda: Thing(n=-1))
    assert (r.value.n, r.source, r.attempts) == (-1, "fallback", 2)
    assert r.reason


def PROMPT(question: str, excerpts: str) -> str:  # noqa: N802
    return f"Question: {question}\n\nExcerpts:\n{excerpts}\n"


def test_offline_llm_quotes_the_best_matching_line() -> None:
    excerpt = '<excerpt id="d/f.md:5-7">\nintro words\nThe canary runs for 10 minutes.\nend\n</excerpt>'
    out = OfflineLlm().complete(LlmRequest(prompt=PROMPT("How long does the canary run?", excerpt)))
    data = json.loads(out.text)
    assert data["citations"] == [
        {"chunk_id": "d/f.md:5-7", "quote": "The canary runs for 10 minutes."}
    ]
    assert data["answer"] == "The canary runs for 10 minutes."
    assert out.model == "offline-generator"


def test_offline_llm_refuses_when_nothing_matches() -> None:
    excerpt = '<excerpt id="d/f.md:1-1">\nunrelated\n</excerpt>'
    out = OfflineLlm().complete(LlmRequest(prompt=PROMPT("zebra stripes?", excerpt)))
    assert json.loads(out.text)["refused"] is True
