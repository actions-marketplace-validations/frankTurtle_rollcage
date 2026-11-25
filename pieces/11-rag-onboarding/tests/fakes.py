"""Test doubles. Nothing here touches the network or downloads a model."""

from pathlib import Path

from rag_onboarding.models import Chunk

ROOT = Path(__file__).resolve().parent.parent
VOCAB = ("approval", "deploy", "queue", "secret", "rollback", "port")


class KeywordEmbedder:
    """Deterministic fake embedder: counts a few keywords, plus a constant so no vector is zero."""

    name = "keyword"

    def __init__(self) -> None:
        self.calls: list[list[str]] = []

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        return [[float(t.lower().count(w)) for w in VOCAB] + [0.01] for t in texts]


def make_chunk(path: str, start: int, text: str) -> Chunk:
    end = start + text.count("\n")
    return Chunk(
        chunk_id=f"{path}:{start}-{end}", path=path, start_line=start, end_line=end, text=text
    )
