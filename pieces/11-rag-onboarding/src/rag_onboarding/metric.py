"""Time to first merged PR: median days from start date to first merged PR, per cohort."""

import csv
import statistics
from datetime import date
from pathlib import Path

COLUMNS = ["cohort", "start_date", "first_merged_pr_date"]


def median_days_by_cohort(path: Path) -> dict[str, tuple[int, float]]:
    """Return {cohort: (people, median days)}. Raises ValueError naming the first bad row."""
    days: dict[str, list[int]] = {}
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != COLUMNS:
            raise ValueError(f"expected columns {', '.join(COLUMNS)}")
        for number, row in enumerate(reader, start=2):
            try:
                start = date.fromisoformat(row["start_date"])
                merged = date.fromisoformat(row["first_merged_pr_date"])
            except ValueError as err:
                raise ValueError(f"row {number}: {err}") from err
            if merged < start:
                raise ValueError(f"row {number}: first PR is before the start date")
            days.setdefault(row["cohort"], []).append((merged - start).days)
    return {c: (len(d), float(statistics.median(d))) for c, d in days.items()}
