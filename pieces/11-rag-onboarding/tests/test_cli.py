"""AC-10 (baseline gate) and AC-11 (CLI), run offline against the committed sample corpus."""

import json
from pathlib import Path

import pytest

from rag_onboarding.cli import main

from .fakes import ROOT


def write_cfg(tmp_path: Path, **overrides: str) -> Path:
    values = {
        "sources": f"[{ROOT / 'demo/sample-repo'}, {ROOT / 'demo/runbooks'}]",
        "index_dir": str(tmp_path / "idx"),
        "fixtures_dir": str(ROOT / "eval/llm-fixtures"),
        "eval_set": str(ROOT / "eval/eval_set.json"),
        "baseline": str(ROOT / "eval/baseline.json"),
    }
    values.update(overrides)
    cfg = tmp_path / "rag.yml"
    cfg.write_text("".join(f"{k}: {v}\n" for k, v in values.items()))
    return cfg


def run(argv: list[str], capsys: pytest.CaptureFixture[str]) -> tuple[int, str, str]:
    code = main(argv, env={})
    cap = capsys.readouterr()
    return code, cap.out, cap.err


def test_index_then_ask_with_citation(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cfg = str(write_cfg(tmp_path))
    code, out, _ = run(["index", "--config", cfg], capsys)
    assert code == 0 and "indexed" in out
    code, out, _ = run(
        ["ask", "--config", cfg, "How many approvals does a pull request need?"], capsys
    )
    assert code == 0
    assert "sample-repo/CONTRIBUTING.md:9" in out
    assert "Two approvals are required" in out


def test_ask_refuses_out_of_scope(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cfg = str(write_cfg(tmp_path))
    code, out, _ = run(["ask", "--config", cfg, "Who won the 2022 World Cup?"], capsys)
    assert code == 0 and "Not in the sources" in out


def test_ask_json_and_fallback_without_fixture(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cfg = str(write_cfg(tmp_path))
    q = "What is the canary step in the production deploy workflow?"
    code, out, _ = run(["ask", "--config", cfg, "--json", q], capsys)
    data = json.loads(out)
    assert code == 0 and data["source"] == "fallback"
    assert data["citations"][0]["path"].startswith(("runbooks/", "sample-repo/"))


def test_ask_is_deterministic(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    cfg = str(write_cfg(tmp_path))
    q = "How often should the payment webhook secret be rotated?"
    first = run(["ask", "--config", cfg, q], capsys)
    second = run(["ask", "--config", cfg, q], capsys)
    assert first == second


def test_eval_passes_committed_baseline(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _ = run(["eval", "--config", str(write_cfg(tmp_path))], capsys)
    assert code == 0, out
    assert "PASS" in out and "accuracy" in out


def test_eval_fails_on_regression(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    bad = tmp_path / "bad.json"
    bad.write_text(
        json.dumps(
            [{"id": "x", "question": "How many approvals does a pull request need?", "refuse": True}]
        )
    )
    baseline = tmp_path / "baseline.json"
    baseline.write_text(json.dumps({"accuracy": 1.0, "total": 1}))
    cfg = write_cfg(tmp_path, eval_set=str(bad), baseline=str(baseline))
    code, out, _ = run(["eval", "--config", str(cfg)], capsys)
    assert code == 1 and "FAIL" in out and "x" in out


def test_eval_write_baseline(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    baseline = tmp_path / "baseline.json"
    cfg = write_cfg(tmp_path, baseline=str(baseline))
    code, _, _ = run(["eval", "--config", str(cfg), "--write-baseline"], capsys)
    assert code == 0
    data = json.loads(baseline.read_text())
    assert data["total"] >= 15 and 0.0 < data["accuracy"] <= 1.0


def test_fixtures_command_records_what_eval_replays(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    fixtures = tmp_path / "fx"
    cfg = str(write_cfg(tmp_path, fixtures_dir=str(fixtures)))
    code, out, _ = run(["fixtures", "--config", cfg], capsys)
    assert code == 0 and "recorded" in out
    assert any(fixtures.glob("*.json"))
    code, out, _ = run(["eval", "--config", cfg], capsys)
    assert code == 0, out


def test_metric_command(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    csv = ROOT / "demo/onboarding-sample.csv"
    code, out, _ = run(["metric", str(csv)], capsys)
    assert code == 0 and "median days" in out and "SYNTHETIC" in out


def test_errors_exit_2(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    code, _, err = run(["ask", "--config", str(tmp_path / "missing.yml"), "q"], capsys)
    assert code == 2 and "error" in err
    code, _, err = run(["metric", str(tmp_path / "missing.csv")], capsys)
    assert code == 2
    code, _, err = run(["ask", "--live", "--config", str(write_cfg(tmp_path)), "q"], capsys)
    assert code == 2 and "ANTHROPIC_API_KEY" in err
