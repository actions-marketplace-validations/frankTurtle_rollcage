"""Data shapes shared across the package."""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class Chunk(BaseModel):
    """A window of consecutive lines from one file. Lines are 1-based and inclusive."""

    model_config = ConfigDict(frozen=True)

    chunk_id: str
    path: str
    start_line: int
    end_line: int
    text: str


class Hit(BaseModel):
    """A retrieved chunk with its cosine similarity (1.0 is identical)."""

    model_config = ConfigDict(frozen=True)

    chunk: Chunk
    score: float


class Citation(BaseModel):
    """A verbatim quote and where it sits in the file."""

    model_config = ConfigDict(frozen=True)

    path: str
    start_line: int
    end_line: int
    quote: str

    @property
    def label(self) -> str:
        if self.start_line == self.end_line:
            return f"{self.path}:{self.start_line}"
        return f"{self.path}:{self.start_line}-{self.end_line}"


class Answer(BaseModel):
    """What the agent returns.

    `source` says who decided: the deterministic gate (`gate`), a validated model answer
    (`model`), or the extractive fallback (`fallback`).
    """

    question: str
    text: str
    citations: list[Citation]
    refused: bool = False
    reason: str | None = None
    source: Literal["gate", "model", "fallback"]
    note: str | None = None
