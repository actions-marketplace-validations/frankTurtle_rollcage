"""Word-level helpers used by the refusal gate, the extractive fallback and the offline model."""

import math
import re
from collections.abc import Sequence

_TOKEN = re.compile(r"[a-z0-9]+")

# Question words and other filler that say nothing about the topic.
STOPWORDS = frozenset(
    """
    a about an and any are as at be been by can could did do does during for from get give go
    has have how i if in into is it its long many me much must my need needs of often on or our
    should so take takes than that the their them then there these they this to us use was we
    what when where which who whom why will with would you your
    """.split()  # noqa: SIM905
)


def stem(word: str) -> str:
    """Crude suffix stripping so `approvals`, `rotated` and `deploying` meet their base words."""
    if len(word) > 4 and word.endswith("ies"):
        word = word[:-3] + "y"
    elif len(word) > 5 and word.endswith("ing"):
        word = word[:-3]
    elif len(word) > 4 and word.endswith(("ed", "es")):
        word = word[:-2]
    elif len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        word = word[:-1]
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    return word


def content_tokens(text: str) -> list[str]:
    """Stemmed non-filler tokens in order, repeats kept."""
    return [
        stem(w)
        for w in _TOKEN.findall(text.lower())
        if w not in STOPWORDS and stem(w) not in STOPWORDS
    ]


def content_words(text: str) -> set[str]:
    return set(content_tokens(text))


def coverage(question_words: set[str], text: str) -> float:
    """Share of the question's content words that appear in `text`."""
    if not question_words:
        return 0.0
    present = {stem(w) for w in _TOKEN.findall(text.lower())}
    return len(question_words & present) / len(question_words)


def _idf(word: str, line_words: Sequence[set[str]]) -> float:
    return math.log(1 + len(line_words) / sum(word in lw for lw in line_words))


def best_lines(question: str, lines: Sequence[str], limit: int = 1) -> list[int]:
    """Indexes of the lines that best match the question, best first.

    A shared word counts more when few of the lines contain it (the weight is squared, so one
    rare term like `approval` beats two common ones like `pull` and `request`). Headings count
    a little less than body text. Lines sharing no word are never returned. Ties keep file
    order.
    """
    words = content_words(question)
    line_words = [content_words(line) for line in lines]
    scored: list[tuple[float, int]] = []
    for i, found in enumerate(line_words):
        shared = words & found
        if not shared:
            continue
        weight = sum(_idf(w, line_words) ** 2 for w in shared)
        scored.append((weight * (0.9 if lines[i].lstrip().startswith("#") else 1.0), i))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [i for _, i in scored[:limit]]
