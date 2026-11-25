"""Demo driver. Offline by default: hashed embeddings and recorded model responses.

The sample service and runbooks are invented. The recorded responses come from a scripted
generator, not a model. Pass --live (or set DEMO_LIVE=1) to use ONNX embeddings, which download a
model on first use, and the Anthropic API.
"""

import os
import sys
from collections.abc import Callable
from pathlib import Path

from rag_onboarding.answerer import format_answer
from rag_onboarding.cli import main as cli
from rag_onboarding.config import load_settings
from rag_onboarding.evaluation import load_eval_set, run_eval
from rag_onboarding.llm import is_live
from rag_onboarding.loader import load_files
from rag_onboarding.pipeline import build_answerer, build_embedder, build_llm, index

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "rag.yml"
QUESTIONS = [
    "How many approvals does a pull request need?",
    "How many minutes does the canary run?",
    "Can I run a down migration in production?",
    "Which AWS region do we run in?",
]
TTY = sys.stdout.isatty()


def header(text: str) -> None:
    line = f"== {text} =="
    print(f"\n\x1b[1m{line}\x1b[0m" if TTY else f"\n{line}")


def before(live: bool) -> None:
    header("BEFORE: finding the answer by hand")
    settings = load_settings(CONFIG)
    print('Question: "How many approvals does a pull request need?"')
    print('Plain text search for "approval":\n')
    for file in load_files(settings.sources, frozenset(settings.extensions)):
        for number, line in enumerate(file.lines, start=1):
            if "approval" in line.lower():
                print(f"{file.path}:{number}")
                print(f"  {line.strip()[:70]}")
    print("\nNo ranking, no answer. You still open the files and decide.")


def run(live: bool) -> None:
    header("RUN: ask questions, with citations")
    settings = load_settings(CONFIG)
    store, count, _ = index(settings, build_embedder(live))
    print(f"Indexed {count} chunks of the sample repo and runbooks (SAMPLE data).")
    answerer = build_answerer(settings, store, build_llm(settings, live, os.environ))
    for question in QUESTIONS:
        print(f"\n> {question}\n")
        print(format_answer(answerer.ask(question)))


def after(live: bool) -> None:
    header("AFTER: the eval gate")
    code = cli(["eval", "--config", str(CONFIG), *(["--live"] if live else [])])
    if code != 0:
        sys.exit(code)
    print("\nA change that lowers accuracy exits 1, and CI fails.")


def metric(live: bool) -> None:
    header("METRIC: eval accuracy")
    settings = load_settings(CONFIG)
    store, _, _ = index(settings, build_embedder(live))
    answerer = build_answerer(settings, store, build_llm(settings, live, os.environ))
    report = run_eval(load_eval_set(settings.eval_set), answerer.ask)
    print(f"Eval accuracy: {report.accuracy:.1%} of {report.total} questions")
    header("METRIC: time to first merged PR (SYNTHETIC cohorts, made-up dates)")
    cli(["metric", str(ROOT / "demo" / "onboarding-sample.csv")])


STAGES: dict[str, Callable[[bool], None]] = {
    "before": before,
    "run": run,
    "after": after,
    "metric": metric,
}


def main(argv: list[str]) -> int:
    live = "--live" in argv or is_live(os.environ)
    names = [a for a in argv if not a.startswith("--")] or ["all"]
    requested = list(STAGES) if names[0] == "all" else names[:1]
    for name in requested:
        stage = STAGES.get(name)
        if stage is None:
            print(f"unknown stage: {name} (use all or {', '.join(STAGES)})", file=sys.stderr)
            return 2
        stage(live)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
