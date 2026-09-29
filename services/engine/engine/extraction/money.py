"""Money parsing (spec §10.2): ₹/Rs/INR with lakh/crore multipliers, Indian digit grouping,
parenthesised negatives. Always returns a Decimal — never a float (spec Non-negotiable rule)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

_MULTIPLIERS = {
    "lakh": Decimal("100000"),
    "lakhs": Decimal("100000"),
    "lac": Decimal("100000"),
    "lacs": Decimal("100000"),
    "crore": Decimal("10000000"),
    "crores": Decimal("10000000"),
    "cr": Decimal("10000000"),
    "cr.": Decimal("10000000"),
    "million": Decimal("1000000"),
    "thousand": Decimal("1000"),
}

# Optional leading currency marker, optional parenthesis-negative, digits with optional
# Indian/plain grouping and decimals, optional trailing multiplier word, optional trailing "/-".
# The number group is deliberately permissive (digits and commas mixed, commas stripped after
# matching) rather than trying to distinguish Indian vs. plain grouping in the pattern itself —
# an alternation split by comma-count previously matched only the first 1-3 digits of a plain
# (comma-free) number like "100000000" and silently dropped the rest.
_MONEY_RE = re.compile(
    r"(?P<neg>\()?"
    r"(?:₹|Rs\.?|INR)?\s*"
    r"(?P<num>\d[\d,]*(?:\.\d+)?)"
    r"\s*(?P<mult>lakhs?|lacs?|crores?|cr\.?|million|thousand)?"
    r"\s*(?:/-)?"
    r"(?P<negclose>\))?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class MoneyMatch:
    amount: Decimal
    raw: str
    unit_context: str | None  # the multiplier word, if any


def parse_money(text: str) -> MoneyMatch | None:
    """Parses a single money expression, e.g. '₹ 10,00,00,000', 'Rs. 10 Cr.', '1.5 lakh',
    '(50,000)'. Returns None if `text` doesn't contain a recognisable amount."""
    m = _MONEY_RE.search(text)
    if not m or not m.group("num"):
        return None
    try:
        amount = Decimal(m.group("num").replace(",", ""))
    except InvalidOperation:
        return None

    mult_word = m.group("mult")
    if mult_word:
        amount *= _MULTIPLIERS.get(mult_word.lower(), Decimal(1))

    if m.group("neg") and m.group("negclose"):
        amount = -amount

    return MoneyMatch(amount=amount, raw=m.group(0).strip(), unit_context=mult_word.lower() if mult_word else None)


def format_inr(amount: Decimal) -> str:
    """Indian-grouped display, e.g. 120000000 -> '₹12,00,00,000' (spec §10.2)."""
    negative = amount < 0
    amount = abs(amount)
    whole = int(amount)
    frac = amount - whole
    s = str(whole)
    if len(s) <= 3:
        grouped = s
    else:
        last3 = s[-3:]
        rest = s[:-3]
        parts: list[str] = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        grouped = ",".join(parts) + "," + last3
    out = f"₹{grouped}"
    if frac:
        out += f".{str(frac).split('.')[1][:2]}"
    return f"-{out}" if negative else out
