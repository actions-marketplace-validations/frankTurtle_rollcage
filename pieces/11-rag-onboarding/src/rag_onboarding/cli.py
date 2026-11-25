"""Command line: index, ask, eval, fixtures, metric.

Exit codes: 0 ok, 1 eval regression, 2 error.
"""

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from rag_onboarding.answerer import Answerer, format_answer
from rag_onboarding.config import Settings, load_settings
from rag_onboarding.evaluation import (
    check_baseline,
    load_eval_set,
    run_eval,
    write_baseline,
)
from rag_onboarding.llm import LlmClient, RecordReplayLlm, is_live
from rag_onboarding.metric import median_days_by_cohort
from rag_onboarding.offline_llm import OfflineLlm
from rag_onboarding.pipeline import build_answerer, build_embedder, build_llm, index


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="rag-onboarding")
    sub = parser.add_subparsers(dest="command", required=True)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--config", default="rag.yml", help="config file (default: rag.yml)")
        p.add_argument(
            "--live",
            action="store_true",
            help="use the ONNX embedder (downloads a model on first use) and the Anthropic API",
        )

    common(sub.add_parser("index", help="index the configured folders"))
    ask = sub.add_parser("ask", help="ask one question")
    common(ask)
    ask.add_argument("question")
    ask.add_argument("--json", action="store_true", help="print the answer as JSON")
    ev = sub.add_parser("eval", help="grade the eval set against the committed baseline")
    common(ev)
    ev.add_argument("--write-baseline", action="store_true", help="store this accuracy as baseline")
    fx = sub.add_parser("fixtures", help="re-record the LLM fixtures the eval set needs")
    common(fx)
    fx.add_argument(
        "--with-model",
        action="store_true",
        help="record real model responses (needs ANTHROPIC_API_KEY) but retrieve with the offline "
        "embedder, so the fixtures replay in the default mode",
    )
    metric = sub.add_parser("metric", help="median days to first merged PR, per cohort")
    metric.add_argument("csv", type=Path)
    return parser


def _answerer(settings: Settings, live: bool, llm: LlmClient) -> Answerer:
    store, _, _ = index(settings, build_embedder(live))
    return build_answerer(settings, store, llm)


def _cmd_index(settings: Settings, live: bool) -> int:
    _, count, changed = index(settings, build_embedder(live))
    state = "indexed" if changed else "index already up to date,"
    print(f"{state} {count} chunks from {len(settings.sources)} folders into {settings.index_dir}")
    return 0


def _cmd_ask(
    settings: Settings, live: bool, env: Mapping[str, str], args: argparse.Namespace
) -> int:
    llm = build_llm(settings, live, env)
    answer = _answerer(settings, live, llm).ask(args.question)
    print(answer.model_dump_json(indent=2) if args.json else format_answer(answer))
    return 0


def _cmd_eval(
    settings: Settings, live: bool, env: Mapping[str, str], args: argparse.Namespace
) -> int:
    answerer = _answerer(settings, live, build_llm(settings, live, env))
    items = load_eval_set(settings.eval_set)
    report = run_eval(items, answerer.ask)
    print(f"== Eval: {report.total} questions ==")
    for r in report.results:
        print(f"{'ok  ' if r.correct else 'FAIL'} {r.id:<4} {r.question}")
    if args.write_baseline:
        write_baseline(report, settings.baseline)
        print(f"baseline written: {report.accuracy:.1%} to {settings.baseline}")
        return 0
    ok, baseline = check_baseline(report.accuracy, settings.baseline)
    right = report.total - len(report.failures)
    print(f"\naccuracy {report.accuracy:.1%} ({right}/{report.total}), baseline {baseline:.1%}")
    print("PASS: at or above the baseline" if ok else "FAIL: accuracy fell below the baseline")
    return 0 if ok else 1


def _cmd_fixtures(
    settings: Settings, live: bool, env: Mapping[str, str], with_model: bool = False
) -> int:
    use_model = live or with_model
    source: LlmClient = build_llm(settings, True, env) if use_model else OfflineLlm()
    for old in settings.fixtures_dir.glob("*.json"):
        old.unlink()
    recorder = RecordReplayLlm(settings.fixtures_dir, "record", source)
    answerer = _answerer(settings, live, recorder)
    for item in load_eval_set(settings.eval_set):
        answerer.ask(item.question)
    count = len(list(settings.fixtures_dir.glob("*.json")))
    who = "a live model" if use_model else "the offline generator (not a model)"
    print(f"recorded {count} fixtures in {settings.fixtures_dir} using {who}")
    return 0


def _cmd_metric(path: Path) -> int:
    print(f"Time to first merged PR, from {path.name}")
    for cohort, (people, median) in median_days_by_cohort(path).items():
        print(f"  {cohort}: median days {median:.1f} (n={people})")
    return 0


def main(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    env = os.environ if env is None else env
    args = _parser().parse_args(argv)
    try:
        if args.command == "metric":
            return _cmd_metric(args.csv)
        settings = load_settings(Path(args.config))
        live = args.live or is_live(env)
        if args.command == "index":
            return _cmd_index(settings, live)
        if args.command == "ask":
            return _cmd_ask(settings, live, env, args)
        if args.command == "eval":
            return _cmd_eval(settings, live, env, args)
        return _cmd_fixtures(settings, live, env, args.with_model)
    except (OSError, ValueError, RuntimeError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
