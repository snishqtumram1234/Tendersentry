"""Identifier regex + validators (spec §10.1). Kept in sync by hand with
apps/api/src/lib/ (TS mirror not yet extracted to packages/validators — Phase 1 deviation, see
docs/PROGRESS.md)."""

from __future__ import annotations

import re
from dataclasses import dataclass

PAN_RE = re.compile(r"[A-Z]{5}[0-9]{4}[A-Z]")
GSTIN_RE = re.compile(r"[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")

_PAN_FOURTH_CHAR_TYPES = set("CPHFATBLJG")
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


@dataclass(frozen=True)
class FieldMatch:
    field: str  # "PAN" | "GSTIN"
    value: str
    valid: bool  # structural/checksum validity, not authenticity (spec §10.6)
    flags: tuple[str, ...]


def gstin_checksum_ok(gstin: str) -> bool:
    """Spec §10.1 — exact algorithm, must match the TS implementation bit-for-bit."""
    if len(gstin) != 15:
        return False
    total = 0
    for i, ch in enumerate(gstin[:14]):
        if ch not in _GSTIN_CHARS:
            return False
        v = _GSTIN_CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += v // 36 + v % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36] == gstin[14]


def find_pan_matches(text: str) -> list[FieldMatch]:
    matches: list[FieldMatch] = []
    for m in PAN_RE.finditer(text):
        value = m.group(0)
        flags: list[str] = []
        if value[3] not in _PAN_FOURTH_CHAR_TYPES:
            flags.append("PAN_TYPE_UNKNOWN")
        matches.append(FieldMatch(field="PAN", value=value, valid=not flags, flags=tuple(flags)))
    return matches


def find_gstin_matches(text: str) -> list[FieldMatch]:
    matches: list[FieldMatch] = []
    for m in GSTIN_RE.finditer(text):
        value = m.group(0)
        flags: list[str] = []
        state_code = int(value[0:2])
        if not (1 <= state_code <= 38 or state_code in (97, 99)):
            flags.append("GSTIN_STATE_CODE_INVALID")
        if not gstin_checksum_ok(value):
            flags.append("GSTIN_CHECKSUM_INVALID")
        matches.append(FieldMatch(field="GSTIN", value=value, valid=not flags, flags=tuple(flags)))
    return matches
