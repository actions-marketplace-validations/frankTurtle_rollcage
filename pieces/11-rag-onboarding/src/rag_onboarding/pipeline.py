"""Wire the pieces together: files to chunks to Chroma to an `Answerer`."""

from collections.abc import Mapping

from rag_onboarding.answerer import Answerer
from rag_onboarding.chunker import chunk_file
from rag_onboarding.config import Settings
from rag_onboarding.embedder import Embedder, make_embedder
from rag_onboarding.llm import AnthropicLlm, LlmClient, RecordReplayLlm
from rag_onboarding.loader import load_files
from rag_onboarding.models import Chunk
from rag_onboarding.store import ChromaStore


def load_chunks(settings: Settings) -> list[Chunk]:
    files = load_files(settings.sources, frozenset(settings.extensions))
    return [
        chunk
        for file in files
        for chunk in chunk_file(file, settings.chunk_lines, settings.chunk_overlap)
    ]


def build_llm(settings: Settings, live: bool, env: Mapping[str, str]) -> LlmClient:
    """Default: replay recorded fixtures. Live: the Anthropic API (needs ANTHROPIC_API_KEY)."""
    return AnthropicLlm(env) if live else RecordReplayLlm(settings.fixtures_dir)


def build_embedder(live: bool) -> Embedder:
    """Default: the offline hashed embedder. Live: ONNX, which downloads a model on first use."""
    return make_embedder("onnx" if live else "hash")


def index(settings: Settings, embedder: Embedder) -> tuple[ChromaStore, int, bool]:
    """Index the sources. Returns (store, chunk count, whether anything was re-indexed)."""
    chunks = load_chunks(settings)
    store = ChromaStore(embedder, settings.index_dir)
    changed = store.ensure(chunks)
    return store, len(chunks), changed


def build_answerer(settings: Settings, store: ChromaStore, llm: LlmClient) -> Answerer:
    return Answerer(
        store,
        llm,
        top_k=settings.top_k,
        min_score=settings.min_score,
        min_coverage=settings.min_coverage,
    )
