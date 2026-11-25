"""ChromaDB store. We compute embeddings ourselves, so Chroma never loads a model on its own."""

import contextlib
import hashlib
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import chromadb
from chromadb.config import Settings as ChromaSettings

from rag_onboarding.embedder import Embedder
from rag_onboarding.models import Chunk, Hit

# A high ef_search makes the approximate index exact at this scale, so rankings do not wobble
# between machines.
_HNSW: dict[str, Any] = {"space": "cosine", "ef_construction": 200, "ef_search": 200}


def fingerprint(chunks: Sequence[Chunk], embedder: Embedder) -> str:
    """Changes when the chunks change or the embedder's `version` is bumped."""
    version = getattr(embedder, "version", "")
    payload = json.dumps([embedder.name, version, [c.model_dump() for c in chunks]], sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


class ChromaStore:
    def __init__(self, embedder: Embedder, path: Path) -> None:
        self._embedder = embedder
        self._name = f"rag_{embedder.name}"
        self._client = chromadb.PersistentClient(
            path=str(path),
            settings=ChromaSettings(anonymized_telemetry=False),
        )

    def _collection(self) -> Any:
        return self._client.get_collection(self._name, embedding_function=None)

    def _stored_fingerprint(self) -> str | None:
        try:
            meta = self._collection().metadata or {}
        except Exception:
            return None
        value = meta.get("fingerprint")
        return value if isinstance(value, str) else None

    def ensure(self, chunks: Sequence[Chunk]) -> bool:
        """Index `chunks`, replacing what was there. Returns False when nothing changed."""
        digest = fingerprint(chunks, self._embedder)
        if self._stored_fingerprint() == digest:
            return False
        with contextlib.suppress(Exception):  # nothing to delete the first time
            self._client.delete_collection(self._name)
        # chromadb's stubs are narrower than what it accepts (plain lists, a config dict).
        client: Any = self._client
        col = client.create_collection(
            self._name,
            metadata={"fingerprint": digest},
            configuration={"hnsw": _HNSW},
            embedding_function=None,
        )
        if chunks:
            col.add(
                ids=[c.chunk_id for c in chunks],
                embeddings=self._embedder.embed([c.text for c in chunks]),
                documents=[c.text for c in chunks],
                metadatas=[
                    {"path": c.path, "start_line": c.start_line, "end_line": c.end_line}
                    for c in chunks
                ],
            )
        return True

    def count(self) -> int:
        return int(self._collection().count())

    def query(self, question: str, k: int) -> list[Hit]:
        col = self._collection()
        n = min(k, int(col.count()))
        if n == 0:
            return []
        res = col.query(
            query_embeddings=self._embedder.embed([question]),
            n_results=n,
            include=["documents", "metadatas", "distances"],
        )
        hits = []
        for chunk_id, doc, meta, dist in zip(
            res["ids"][0],
            res["documents"][0],
            res["metadatas"][0],
            res["distances"][0],
            strict=True,
        ):
            chunk = Chunk(
                chunk_id=chunk_id,
                path=str(meta["path"]),
                start_line=int(meta["start_line"]),
                end_line=int(meta["end_line"]),
                text=doc,
            )
            hits.append(Hit(chunk=chunk, score=round(1.0 - float(dist), 5)))
        # Ties broken by id so the prompt (and so its recorded fixture) never depends on ANN order.
        return sorted(hits, key=lambda h: (-h.score, h.chunk.chunk_id))
