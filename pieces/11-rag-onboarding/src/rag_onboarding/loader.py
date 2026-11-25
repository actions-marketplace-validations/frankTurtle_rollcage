"""Read source files into numbered lines."""

from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceFile:
    """`path` is `<folder name>/<relative path>`, the form citations print."""

    path: str
    lines: list[str]


def _wanted(file: Path, extensions: frozenset[str]) -> bool:
    return file.suffix in extensions or file.name in extensions


def load_files(roots: Iterable[Path], extensions: frozenset[str]) -> list[SourceFile]:
    """Load wanted text files under each root, sorted by path. Undecodable files are skipped."""
    out: list[SourceFile] = []
    for root in roots:
        if not root.is_dir():
            raise FileNotFoundError(f"source folder not found: {root}")
        for file in sorted(p for p in root.rglob("*") if p.is_file() and _wanted(p, extensions)):
            try:
                text = file.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            rel = file.relative_to(root).as_posix()
            out.append(SourceFile(path=f"{root.name}/{rel}", lines=text.splitlines()))
    return sorted(out, key=lambda f: f.path)
