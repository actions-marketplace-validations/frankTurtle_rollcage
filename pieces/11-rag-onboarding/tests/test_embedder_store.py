"""AC-2 and AC-3: embedders and the Chroma store."""

import math
import sys
from pathlib import Path

import pytest

from rag_onboarding.embedder import HashEmbedder, make_embedder
from rag_onboarding.store import ChromaStore

from .fakes import KeywordEmbedder, make_chunk


def test_hash_embedder_is_deterministic_and_normalized() -> None:
    e = HashEmbedder(dim=64)
    a, b = e.embed(["Deploy to production", "deploy to PRODUCTION"])
    assert a == b
    assert math.isclose(math.sqrt(sum(v * v for v in a)), 1.0)
    assert e.embed([""]) == [[0.0] * 64]


def test_hash_embedder_scores_shared_words_higher() -> None:
    e = HashEmbedder()
    q, near, far = e.embed(["rotate the webhook secret", "rotate webhook secret", "queue backlog"])
    dot = lambda x, y: sum(i * j for i, j in zip(x, y, strict=True))  # noqa: E731
    assert dot(q, near) > dot(q, far)


def test_onnx_embedder_is_opt_in_and_not_imported_by_default() -> None:
    assert make_embedder("hash").name == "hash"
    onnx = make_embedder("onnx")
    assert onnx.name == "onnx"
    assert "onnxruntime" not in sys.modules
    with pytest.raises(ValueError):
        make_embedder("other")


def test_store_returns_nearest_chunks_with_scores(tmp_path: Path) -> None:
    store = ChromaStore(KeywordEmbedder(), tmp_path / "idx")
    chunks = [
        make_chunk("r/deploy.md", 1, "deploy the release\ndeploy approval"),
        make_chunk("r/queue.md", 1, "queue backlog\nqueue consumers"),
        make_chunk("r/secret.md", 1, "rotate the secret"),
    ]
    store.ensure(chunks)
    hits = store.query("queue backlog", 2)
    assert [h.chunk.chunk_id for h in hits][0] == "r/queue.md:1-2"
    assert len(hits) == 2
    assert 0.0 <= hits[0].score <= 1.0
    assert hits[0].score >= hits[1].score
    assert hits[0].chunk.text == "queue backlog\nqueue consumers"


def test_store_reindex_replaces_and_skips_when_unchanged(tmp_path: Path) -> None:
    emb = KeywordEmbedder()
    store = ChromaStore(emb, tmp_path / "idx")
    first = [make_chunk("r/a.md", 1, "deploy one")]
    assert store.ensure(first) is True
    calls = len(emb.calls)
    assert store.ensure(first) is False
    assert len(emb.calls) == calls
    assert store.ensure([make_chunk("r/b.md", 1, "queue two")]) is True
    assert store.count() == 1
    assert [h.chunk.path for h in store.query("deploy", 5)] == ["r/b.md"]


def test_store_empty_index_returns_no_hits(tmp_path: Path) -> None:
    store = ChromaStore(KeywordEmbedder(), tmp_path / "idx")
    store.ensure([])
    assert store.query("anything", 3) == []
