"""Settings from `rag.yml`. Unknown keys and out-of-range values are rejected."""

from pathlib import Path
from typing import Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sources: list[Path] = [Path("demo/sample-repo"), Path("demo/runbooks")]
    extensions: list[str] = [".md", ".py", ".ts", ".yml", ".yaml", ".toml", ".txt", "Makefile"]
    chunk_lines: int = Field(8, ge=1)
    chunk_overlap: int = Field(2, ge=0)
    top_k: int = Field(4, ge=1)
    min_score: float = Field(0.15, ge=0.0, le=1.0)
    min_coverage: float = Field(0.6, ge=0.0, le=1.0)
    index_dir: Path = Path("demo/out/chroma")
    fixtures_dir: Path = Path("eval/llm-fixtures")
    eval_set: Path = Path("eval/eval_set.json")
    baseline: Path = Path("eval/baseline.json")

    @model_validator(mode="after")
    def _overlap_below_window(self) -> Self:
        if self.chunk_overlap >= self.chunk_lines:
            raise ValueError("chunk_overlap must be less than chunk_lines")
        return self

    def resolved(self, base: Path) -> Self:
        """Copy with every relative path made relative to `base`."""
        return self.model_copy(
            update={
                "sources": [base / p for p in self.sources],
                "index_dir": base / self.index_dir,
                "fixtures_dir": base / self.fixtures_dir,
                "eval_set": base / self.eval_set,
                "baseline": base / self.baseline,
            }
        )


def load_settings(path: Path) -> Settings:
    """Read a config file. Relative paths in it are relative to the file's folder."""
    if not path.is_file():
        raise FileNotFoundError(f"config not found: {path}")
    raw = yaml.safe_load(path.read_text()) or {}
    if not isinstance(raw, dict):
        raise ValueError("config must be a mapping of keys to values")
    return Settings.model_validate(raw).resolved(path.parent)
