"""The eval set, grading, and the committed baseline that CI must not fall below."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Self

from pydantic import BaseModel, model_validator

from rag_onboarding.models import Answer


class EvalItem(BaseModel):
    """Either an answerable question (`path` and `line` a citation must cover) or a refusal."""

    id: str
    question: str
    path: str | None = None
    line: int | None = None
    refuse: bool = False

    @model_validator(mode="after")
    def _one_kind(self) -> Self:
        has_target = self.path is not None and self.line is not None
        if self.refuse == has_target or (self.path is None) != (self.line is None):
            raise ValueError("an eval item needs either refuse=true or both path and line")
        return self


@dataclass(frozen=True)
class EvalResult:
    id: str
    question: str
    correct: bool


@dataclass(frozen=True)
class EvalReport:
    results: list[EvalResult]

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def accuracy(self) -> float:
        return sum(r.correct for r in self.results) / self.total if self.results else 0.0

    @property
    def failures(self) -> list[EvalResult]:
        return [r for r in self.results if not r.correct]


def load_eval_set(path: Path) -> list[EvalItem]:
    return [EvalItem.model_validate(item) for item in json.loads(path.read_text())]


def grade(item: EvalItem, answer: Answer) -> bool:
    if item.refuse:
        return answer.refused
    if answer.refused:
        return False
    return any(
        c.path == item.path and item.line is not None and c.start_line <= item.line <= c.end_line
        for c in answer.citations
    )


def run_eval(items: list[EvalItem], ask: Callable[[str], Answer]) -> EvalReport:
    return EvalReport([EvalResult(i.id, i.question, grade(i, ask(i.question))) for i in items])


def check_baseline(accuracy: float, path: Path) -> tuple[bool, float]:
    """Return (meets baseline, baseline). A missing baseline file means no floor yet."""
    if not path.exists():
        return True, 0.0
    baseline = float(json.loads(path.read_text())["accuracy"])
    return accuracy >= baseline - 1e-9, baseline


def write_baseline(report: EvalReport, path: Path) -> None:
    body = {"accuracy": round(report.accuracy, 4), "total": report.total}
    path.write_text(json.dumps(body, indent=2) + "\n")
