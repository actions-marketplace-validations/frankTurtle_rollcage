"""AC-1: stable line numbers from the loader, correct start and end lines from the chunker."""

from pathlib import Path

import pytest

from rag_onboarding.chunker import chunk_file
from rag_onboarding.loader import SourceFile, load_files

EXTS = frozenset({".md", ".py", "Makefile"})


def test_loader_labels_files_by_folder_and_sorts(tmp_path: Path) -> None:
    root = tmp_path / "runbooks"
    (root / "sub").mkdir(parents=True)
    (root / "b.md").write_text("one\ntwo\n")
    (root / "sub" / "a.md").write_text("alpha\n")
    (root / "skip.bin").write_text("x")
    (root / "Makefile").write_text("all:\n")
    files = load_files([root], EXTS)
    assert [f.path for f in files] == [
        "runbooks/Makefile",
        "runbooks/b.md",
        "runbooks/sub/a.md",
    ]
    assert files[1].lines == ["one", "two"]


def test_loader_skips_undecodable_files_and_missing_roots(tmp_path: Path) -> None:
    root = tmp_path / "docs"
    root.mkdir()
    (root / "bad.md").write_bytes(b"\xff\xfe\x00bad")
    (root / "good.md").write_text("ok\n")
    files = load_files([root], EXTS)
    assert [f.path for f in files] == ["docs/good.md"]
    with pytest.raises(FileNotFoundError):
        load_files([tmp_path / "nope"], EXTS)


def test_chunker_keeps_line_numbers_and_overlap() -> None:
    lines = [f"line {n}" for n in range(1, 11)]
    chunks = chunk_file(SourceFile(path="d/f.md", lines=lines), chunk_lines=4, overlap=1)
    assert [(c.start_line, c.end_line) for c in chunks] == [(1, 4), (4, 7), (7, 10)]
    assert chunks[1].text == "line 4\nline 5\nline 6\nline 7"
    assert chunks[0].chunk_id == "d/f.md:1-4"


def test_chunker_trims_blank_edges_and_skips_blank_windows() -> None:
    lines = ["", "", "a", "b", "", "", "", "", "", "c", ""]
    chunks = chunk_file(SourceFile(path="d/f.md", lines=lines), chunk_lines=4, overlap=0)
    assert [(c.start_line, c.end_line, c.text) for c in chunks] == [
        (3, 4, "a\nb"),
        (10, 10, "c"),
    ]


def test_chunker_rejects_bad_sizes() -> None:
    f = SourceFile(path="d/f.md", lines=["x"])
    with pytest.raises(ValueError):
        chunk_file(f, chunk_lines=0, overlap=0)
    with pytest.raises(ValueError):
        chunk_file(f, chunk_lines=3, overlap=3)
