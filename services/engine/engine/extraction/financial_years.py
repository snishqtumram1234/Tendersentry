"""Indian financial year parsing and period resolution (spec §10.3). FY runs 1 April - 31 March;
canonical label is "FY2024-25" for 1 Apr 2024 - 31 Mar 2025."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

_FY_RE = re.compile(r"\bF\.?Y\.?\s*(\d{4})\s*[-–]\s*(\d{2,4})\b", re.IGNORECASE)
_AY_RE = re.compile(r"\bA\.?Y\.?\s*(\d{4})\s*[-–]\s*(\d{2,4})\b", re.IGNORECASE)
_BARE_RANGE_RE = re.compile(r"\b(\d{4})\s*[-–]\s*(\d{2,4})\b")


def _normalise_end_year(start: int, end_raw: str) -> int:
    if len(end_raw) == 4:
        return int(end_raw)
    # "24-25" style: end is start+1's last two digits.
    return (start // 100) * 100 + int(end_raw)


@dataclass(frozen=True)
class FinancialYear:
    start_year: int  # e.g. 2024 for FY2024-25

    @property
    def label(self) -> str:
        return f"FY{self.start_year}-{str(self.start_year + 1)[-2:]}"

    @property
    def start_date(self) -> date:
        return date(self.start_year, 4, 1)

    @property
    def end_date(self) -> date:
        return date(self.start_year + 1, 3, 31)

    def is_completed(self, reference_date: date) -> bool:
        return self.end_date < reference_date


def parse_fy_mentions(text: str) -> list[FinancialYear]:
    """Finds every FY/AY-style mention in `text` and returns the corresponding FinancialYear list
    (AY converted to the preceding FY, spec §10.3, flagged nowhere here — the caller decides
    whether to record the AY→FY conversion in a trace)."""
    results: list[FinancialYear] = []
    for m in _FY_RE.finditer(text):
        start = int(m.group(1))
        end = _normalise_end_year(start, m.group(2))
        if end == start + 1:
            results.append(FinancialYear(start_year=start))
    for m in _AY_RE.finditer(text):
        start = int(m.group(1))
        end = _normalise_end_year(start, m.group(2))
        if end == start + 1:
            results.append(FinancialYear(start_year=start - 1))  # AY N-N+1 -> FY (N-1)-N
    return results


def last_n_completed_fy(n: int, reference_date: date) -> list[FinancialYear]:
    """The N most recent FYs that ended before `reference_date` (spec §10.3), most recent last."""
    # The FY containing reference_date starts on the most recent 1 April on/before it.
    current_fy_start = reference_date.year if reference_date >= date(reference_date.year, 4, 1) else reference_date.year - 1
    fy = FinancialYear(start_year=current_fy_start)
    completed: list[FinancialYear] = []
    while len(completed) < n:
        if fy.is_completed(reference_date):
            completed.append(fy)
        fy = FinancialYear(start_year=fy.start_year - 1)
    completed.reverse()
    return completed
