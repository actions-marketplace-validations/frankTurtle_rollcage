"""AC-8 and AC-9: LLM interface, fake, record and replay, and the Anthropic client."""

import json
from pathlib import Path

import pytest

from rag_onboarding.llm import (
    DEFAULT_MODEL,
    AnthropicLlm,
    FakeLlm,
    LlmRequest,
    RecordReplayLlm,
    is_live,
    request_key,
    resolve_model,
)


def test_fake_llm_replays_in_order_and_errors_when_exhausted() -> None:
    fake = FakeLlm(["a", RuntimeError("boom"), lambda r: r.prompt.upper()])
    assert fake.complete(LlmRequest(prompt="x")).text == "a"
    with pytest.raises(RuntimeError):
        fake.complete(LlmRequest(prompt="x"))
    assert fake.complete(LlmRequest(prompt="hi")).text == "HI"
    with pytest.raises(RuntimeError, match="no scripted reply"):
        fake.complete(LlmRequest(prompt="x"))
    assert len(fake.calls) == 4


def test_request_key_is_stable_and_ignores_max_tokens() -> None:
    a = request_key(LlmRequest(system="s", prompt="p", max_tokens=10))
    b = request_key(LlmRequest(system="s", prompt="p", max_tokens=99))
    assert a == b
    assert a != request_key(LlmRequest(system="s", prompt="q"))


def test_record_then_replay(tmp_path: Path) -> None:
    live = FakeLlm(["recorded text"], model="m1")
    recorder = RecordReplayLlm(tmp_path, "record", live)
    req = LlmRequest(prompt="question")
    assert recorder.complete(req).text == "recorded text"
    replay = RecordReplayLlm(tmp_path, "replay")
    got = replay.complete(req)
    assert (got.text, got.model) == ("recorded text", "m1")
    with pytest.raises(FileNotFoundError, match="no recorded fixture"):
        replay.complete(LlmRequest(prompt="other"))


def test_record_mode_requires_a_live_client(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="requires a live client"):
        RecordReplayLlm(tmp_path, "record")


def test_resolve_model_prefers_env() -> None:
    assert resolve_model({}) == DEFAULT_MODEL
    assert resolve_model({"ANTHROPIC_MODEL": " custom-model "}) == "custom-model"
    assert resolve_model({"ANTHROPIC_MODEL": "  "}) == DEFAULT_MODEL


def test_is_live_only_for_exact_flag() -> None:
    assert is_live({"DEMO_LIVE": "1"})
    assert not is_live({"DEMO_LIVE": "true"})
    assert not is_live({})


class Transport:
    def __init__(self, status: int, payload: object) -> None:
        self.status = status
        self.payload = payload
        self.seen: list[tuple[str, dict[str, str], dict[str, object]]] = []

    def __call__(self, url: str, headers: dict[str, str], body: bytes) -> tuple[int, bytes]:
        self.seen.append((url, headers, json.loads(body)))
        return self.status, json.dumps(self.payload).encode()


def test_anthropic_requires_key() -> None:
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        AnthropicLlm({}, Transport(200, {}))


def test_anthropic_sends_headers_and_model_from_env() -> None:
    t = Transport(200, {"content": [{"type": "text", "text": "he"}, {"type": "text", "text": "llo"}]})
    llm = AnthropicLlm({"ANTHROPIC_API_KEY": "sk-test-fake", "ANTHROPIC_MODEL": "env-model"}, t)
    out = llm.complete(LlmRequest(system="sys", prompt="p"))
    assert (out.text, out.model) == ("hello", "env-model")
    url, headers, body = t.seen[0]
    assert url == "https://api.anthropic.com/v1/messages"
    assert headers["x-api-key"] == "sk-test-fake"
    assert headers["anthropic-version"] == "2023-06-01"
    assert body["model"] == "env-model"
    assert body["system"] == "sys"


def test_anthropic_error_has_status_only() -> None:
    t = Transport(429, {"error": "secret detail sk-test-fake"})
    llm = AnthropicLlm({"ANTHROPIC_API_KEY": "sk-test-fake"}, t)
    with pytest.raises(RuntimeError) as err:
        llm.complete(LlmRequest(prompt="p"))
    assert "429" in str(err.value)
    assert "secret detail" not in str(err.value)
    assert "sk-test-fake" not in str(err.value)
