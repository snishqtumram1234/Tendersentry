"""Date parsing (spec §10.1): dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, "12 March 2025",
"12th Mar, 2025", yyyy-mm-dd. Indian day-first default."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

_MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
    "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}

_NUMERIC_RE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b")
_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
_TEXTUAL_RE = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DateMatch:
    value: date
    raw: str
    confidence: float  # 1.0 for unambiguous (ISO, textual month); 0.85 for day-first numeric (spec §10.1)


def find_dates(text: str) -> list[DateMatch]:
    matches: list[DateMatch] = []

    for m in _ISO_RE.finditer(text):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            matches.append(DateMatch(value=date(y, mo, d), raw=m.group(0), confidence=1.0))
        except ValueError:
            continue

    for m in _TEXTUAL_RE.finditer(text):
        month = _MONTHS.get(m.group(2).lower())
        if not month:
            continue
        try:
            matches.append(DateMatch(value=date(int(m.group(3)), month, int(m.group(1))), raw=m.group(0), confidence=1.0))
        except ValueError:
            continue

    for m in _NUMERIC_RE.finditer(text):
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        # Indian day-first default (dd/mm/yyyy). If `a` can't be a month (>12), the order is
        # actually unambiguous regardless of which convention was intended; only when BOTH
        # numbers are <=12 are we genuinely guessing — spec §10.1: "ambiguous -> confidence penalty".
        if a > 12:
            day, month, confidence = a, b, 1.0
        elif b > 12:
            day, month, confidence = b, a, 1.0
        else:
            day, month, confidence = a, b, 0.85
        try:
            matches.append(DateMatch(value=date(y, month, day), raw=m.group(0), confidence=confidence))
        except ValueError:
            continue

    return matches
