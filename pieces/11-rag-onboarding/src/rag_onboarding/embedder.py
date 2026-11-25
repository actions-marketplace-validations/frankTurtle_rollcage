"""Embedders. Tests and the default demo use `HashEmbedder`; ONNX is opt-in."""

import hashlib
import math
from typing import Protocol

from rag_onboarding.text import content_tokens


class Embedder(Protocol):
    """Maps texts to fixed-size vectors, same order in and out.

    An optional `version` string should change whenever the vectors for the same text change,
    so a saved index is rebuilt instead of reused.
    """

    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class HashEmbedder:
    """Deterministic hashed bag of words, L2-normalized. Matches words, not meaning.

    Offline and instant, so tests and the default demo never download anything.
    Same idea as MatterBrief's `HashEmbedder`, with stemming and filler words removed.
    """

    name = "hash"
    version = "2"  # bump when tokenizing or hashing changes

    def __init__(self, dim: int = 256) -> None:
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        for token in content_tokens(text):
            digest = hashlib.blake2b(token.encode(), digest_size=8).digest()
            vec[int.from_bytes(digest, "big") % self.dim] += 1.0
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec


class OnnxEmbedder:
    """Chroma's bundled MiniLM ONNX model. Downloads the model on first use, so it is opt-in."""

    name = "onnx"
    version = "chroma-default-minilm"

    def __init__(self) -> None:
        self._fn: object | None = None

    def embed(self, texts: list[str]) -> list[list[float]]:
        if self._fn is None:
            from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

            self._fn = DefaultEmbeddingFunction()
        vectors = self._fn(texts)  # type: ignore[operator]
        return [[float(v) for v in vec] for vec in vectors]


def make_embedder(kind: str) -> Embedder:
    if kind == "hash":
        return HashEmbedder()
    if kind == "onnx":
        return OnnxEmbedder()
    raise ValueError(f"unknown embedder '{kind}' (use hash or onnx)")
