"""The only door to a language model.

Mirrors shared/ts/src/llm.ts, fake-llm.ts, replay.ts, anthropic.ts and config.ts.
"""

import hashlib
import json
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

# Same default and source as shared/ts/src/config.ts. Override with ANTHROPIC_MODEL.
DEFAULT_MODEL = "claude-sonnet-5-5"
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"


@dataclass(frozen=True)
class LlmRequest:
    prompt: str
    system: str | None = None
    max_tokens: int = 1024
    model: str | None = None


@dataclass(frozen=True)
class LlmResponse:
    text: str
    model: str


class LlmClient(Protocol):
    def complete(self, request: LlmRequest) -> LlmResponse: ...


def resolve_model(env: Mapping[str, str]) -> str:
    return env.get("ANTHROPIC_MODEL", "").strip() or DEFAULT_MODEL


def is_live(env: Mapping[str, str]) -> bool:
    """Live mode (ONNX embeddings, Anthropic) is opt-in. Tests and default demos never set this."""
    return env.get("DEMO_LIVE") == "1"


def request_key(request: LlmRequest) -> str:
    """Hash of the fields that determine a response. Used as the fixture file name."""
    canonical = json.dumps(
        {"system": request.system, "prompt": request.prompt, "model": request.model},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


FakeReply = str | Exception | Callable[[LlmRequest], str]


class FakeLlm:
    """Scripted replies, consumed in order. Running out raises, so a test never gets a default."""

    def __init__(self, replies: list[FakeReply], model: str = "fake-model") -> None:
        self.calls: list[LlmRequest] = []
        self._replies = list(replies)
        self._model = model

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.calls.append(request)
        if not self._replies:
            raise RuntimeError("FakeLlm: no scripted reply left for this call")
        nxt = self._replies.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        text = nxt(request) if callable(nxt) else nxt
        return LlmResponse(text=text, model=self._model)


class RecordReplayLlm:
    """replay (default): answer only from fixture files; a missing one raises. No network.

    record: call the wrapped client and write its response to a fixture.
    """

    def __init__(
        self,
        fixture_dir: Path,
        mode: Literal["replay", "record"] = "replay",
        live: LlmClient | None = None,
    ) -> None:
        if mode == "record" and live is None:
            raise ValueError("RecordReplayLlm: record mode requires a live client")
        self._dir = fixture_dir
        self._mode = mode
        self._live = live

    def fixture_path(self, request: LlmRequest) -> Path:
        return self._dir / f"{request_key(request)}.json"

    def complete(self, request: LlmRequest) -> LlmResponse:
        path = self.fixture_path(request)
        if self._mode == "replay":
            if not path.exists():
                raise FileNotFoundError(f"no recorded fixture at {path.name}")
            data = json.loads(path.read_text())
            return LlmResponse(text=data["text"], model=data["model"])
        assert self._live is not None
        response = self._live.complete(request)
        self._dir.mkdir(parents=True, exist_ok=True)
        body = {"text": response.text, "model": response.model}
        path.write_text(json.dumps(body, indent=2) + "\n")
        return response


Transport = Callable[[str, dict[str, str], bytes], tuple[int, bytes]]


def _urllib_transport(
    url: str, headers: dict[str, str], body: bytes
) -> tuple[int, bytes]:  # pragma: no cover
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return int(res.status), bytes(res.read())
    except urllib.error.HTTPError as err:
        return err.code, b""


class AnthropicLlm:
    """Anthropic Messages API over plain HTTP (no SDK). Live mode only.

    The key comes from the environment and is never logged. Errors carry the status code only.
    """

    def __init__(self, env: Mapping[str, str], transport: Transport = _urllib_transport) -> None:
        key = env.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("AnthropicLlm: ANTHROPIC_API_KEY is not set in the environment")
        self._key = key
        self._env = env
        self._transport = transport

    def complete(self, request: LlmRequest) -> LlmResponse:
        model = request.model or resolve_model(self._env)
        body: dict[str, object] = {
            "model": model,
            "max_tokens": request.max_tokens,
            "messages": [{"role": "user", "content": request.prompt}],
        }
        if request.system:
            body["system"] = request.system
        headers = {
            "content-type": "application/json",
            "x-api-key": self._key,
            "anthropic-version": API_VERSION,
        }
        status, raw = self._transport(API_URL, headers, json.dumps(body).encode())
        if status != 200:
            raise RuntimeError(f"AnthropicLlm: API request failed with status {status}")
        blocks = json.loads(raw).get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        return LlmResponse(text=text, model=model)
