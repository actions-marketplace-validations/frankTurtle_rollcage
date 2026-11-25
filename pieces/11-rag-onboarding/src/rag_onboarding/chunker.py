"""Split a file into overlapping line windows that remember their real line numbers."""

from rag_onboarding.loader import SourceFile
from rag_onboarding.models import Chunk


def chunk_file(file: SourceFile, chunk_lines: int, overlap: int) -> list[Chunk]:
    if chunk_lines < 1:
        raise ValueError("chunk_lines must be at least 1")
    if not 0 <= overlap < chunk_lines:
        raise ValueError("overlap must be at least 0 and less than chunk_lines")
    step = chunk_lines - overlap
    chunks: list[Chunk] = []
    for offset in range(0, len(file.lines), step):
        window = file.lines[offset : offset + chunk_lines]
        # Trim blank edges so the cited range starts and ends on real text.
        first = next((i for i, line in enumerate(window) if line.strip()), None)
        if first is None:
            continue
        last = max(i for i, line in enumerate(window) if line.strip())
        start = offset + first + 1
        end = offset + last + 1
        chunks.append(
            Chunk(
                chunk_id=f"{file.path}:{start}-{end}",
                path=file.path,
                start_line=start,
                end_line=end,
                text="\n".join(window[first : last + 1]),
            )
        )
        if offset + chunk_lines >= len(file.lines):
            break
    return chunks
