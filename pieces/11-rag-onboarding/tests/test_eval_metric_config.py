"""AC-10, AC-12, AC-13: eval grading and baseline, the metric, config."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from rag_onboarding.config import Settings, load_settings
from rag_onboarding.evaluation import (
    EvalItem,
    check_baseline,
    grade,
    load_eval_set,
    run_eval,
)
from rag_onboarding.metric import median_days_by_cohort
from rag_onboarding.models import Answer, Citation

from .fakes import ROOT


def answer(*cites: Citation, refused: bool = False) -> Answer:
    return Answer(
        question="q", text="t", citations=list(cites), refused=refused, source="model"
    )


def test_grade_answerable_needs_a_citation_covering_the_line() -> None:
    item = EvalItem(id="a", question="q", path="runbooks/deploy.md", line=16)
    hit = Citation(path="runbooks/deploy.md", start_line=15, end_line=17, quote="x")
    miss_line = Citation(path="runbooks/deploy.md", start_line=1, end_line=2, quote="x")
    miss_file = Citation(path="runbooks/other.md", start_line=16, end_line=16, quote="x")
    assert grade(item, answer(hit))
    assert not grade(item, answer(miss_line))
    assert not grade(item, answer(miss_file))
    assert not grade(item, answer(hit, refused=True))


def test_grade_refusal_items() -> None:
    item = EvalItem(id="r", question="q", refuse=True)
    assert grade(item, answer(refused=True))
    assert not grade(item, answer(Citation(path="p", start_line=1, end_line=1, quote="x")))


def test_eval_item_must_be_exactly_one_kind() -> None:
    with pytest.raises(ValidationError):
        EvalItem(id="x", question="q")
    with pytest.raises(ValidationError):
        EvalItem(id="x", question="q", refuse=True, path="p", line=1)
    with pytest.raises(ValidationError):
        EvalItem(id="x", question="q", path="p")


def test_run_eval_reports_accuracy_and_failures() -> None:
    items = [
        EvalItem(id="r1", question="refuse me", refuse=True),
        EvalItem(id="r2", question="refuse me too", refuse=True),
    ]
    results = iter([answer(refused=True), answer()])
    report = run_eval(items, lambda q: next(results))
    assert report.accuracy == 0.5
    assert [r.id for r in report.failures] == ["r2"]
    assert report.total == 2


def test_check_baseline(tmp_path: Path) -> None:
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps({"accuracy": 0.9, "total": 20}))
    assert check_baseline(0.9, path) == (True, 0.9)
    assert check_baseline(0.95, path)[0]
    assert check_baseline(0.85, path) == (False, 0.9)
    assert check_baseline(0.1, tmp_path / "missing.json") == (True, 0.0)


def test_committed_eval_set_is_big_enough_and_has_refusals() -> None:
    items = load_eval_set(ROOT / "eval" / "eval_set.json")
    assert len(items) >= 15
    assert sum(1 for i in items if i.refuse) >= 3
    assert len({i.id for i in items}) == len(items)


def test_median_days_by_cohort(tmp_path: Path) -> None:
    csv = tmp_path / "c.csv"
    csv.write_text(
        "cohort,start_date,first_merged_pr_date\n"
        "before,2026-01-05,2026-01-25\n"
        "before,2026-01-12,2026-02-01\n"
        "before,2026-01-19,2026-03-01\n"
        "after,2026-04-06,2026-04-13\n"
    )
    assert median_days_by_cohort(csv) == {"before": (3, 20.0), "after": (1, 7.0)}


def test_metric_rejects_bad_rows(tmp_path: Path) -> None:
    csv = tmp_path / "c.csv"
    csv.write_text("cohort,start_date,first_merged_pr_date\nx,2026-01-05,2026-01-01\n")
    with pytest.raises(ValueError, match="row 2"):
        median_days_by_cohort(csv)
    csv.write_text("cohort,start_date\nx,2026-01-05\n")
    with pytest.raises(ValueError, match="columns"):
        median_days_by_cohort(csv)
    csv.write_text("cohort,start_date,first_merged_pr_date\nx,not-a-date,2026-01-01\n")
    with pytest.raises(ValueError, match="row 2"):
        median_days_by_cohort(csv)


def test_config_defaults_and_resolution(tmp_path: Path) -> None:
    cfg = tmp_path / "rag.yml"
    cfg.write_text("sources: [a, b]\ntop_k: 3\n")
    s = load_settings(cfg)
    assert s.sources == [tmp_path / "a", tmp_path / "b"]
    assert s.top_k == 3
    assert s.chunk_lines == 8 and s.min_coverage == 0.6
    assert Settings().top_k == 4


def test_config_rejects_unknown_keys_and_bad_values(tmp_path: Path) -> None:
    cfg = tmp_path / "rag.yml"
    cfg.write_text("surprise: 1\n")
    with pytest.raises(ValueError, match="surprise"):
        load_settings(cfg)
    cfg.write_text("min_score: 2\n")
    with pytest.raises(ValueError, match="min_score"):
        load_settings(cfg)
    cfg.write_text("chunk_lines: 4\nchunk_overlap: 4\n")
    with pytest.raises(ValueError, match="chunk_overlap"):
        load_settings(cfg)
    cfg.write_text("- not a mapping\n")
    with pytest.raises(ValueError, match="mapping"):
        load_settings(cfg)
    cfg.write_text("")
    assert load_settings(cfg).top_k == 4
    with pytest.raises(FileNotFoundError):
        load_settings(tmp_path / "none.yml")
