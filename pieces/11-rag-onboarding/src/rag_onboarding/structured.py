"""Ask for JSON, validate with pydantic, retry once, then use the deterministic fallback.

Mirrors shared/ts/src/structured.ts.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from rag_onboarding.llm import LlmClient, LlmRequest

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    value: T
    source: Literal["model", "fallback"]
    attempts: int
    reason: str | None = None


def extract_json(text: str) -> Any:
    """Pull a JSON value out of model text, tolerating a ```json fence."""
    fenced = _FENCE.search(text)
    return json.loads((fenced.group(1) if fenced else text).strip())


def complete_structured[T: BaseModel](
    client: LlmClient,
    request: LlmRequest,
    schema: type[T],
    fallback: Callable[[], T],
) -> StructuredResult[T]:
    reason = "unknown"
    for attempt in (1, 2):
        try:
            value = schema.model_validate(extract_json(client.complete(request).text))
            return StructuredResult(value, "model", attempt)
        except ValidationError as err:
            reason = f"schema validation failed: {err.errors()[0]['msg']}"
        except Exception as err:
            reason = str(err) or type(err).__name__
    return StructuredResult(fallback(), "fallback", 2, reason)
