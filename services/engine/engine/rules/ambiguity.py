"""Deterministic ambiguity checks on clause text (spec §11.3), run in addition to whatever the LLM
flags. These catch the exact cases the spec calls out by name — never guessed, always a fixed rule
over the text."""

from __future__ import annotations

import re
from dataclasses import dataclass

_FY_MENTION = re.compile(r"\bfinancial\s+years?\b", re.IGNORECASE)
_COMPLETED_MENTION = re.compile(r"\bcompleted\b", re.IGNORECASE)
_BARE_NUMBER_NO_UNIT = re.compile(r"(?<![₹$%\d])\b\d{1,3}(?:,\d{2,3})*(?:\.\d+)?\b(?!\s*(?:cr|crore|lakh|lac|%|percent|inr|rs\.?|₹|years?|days?|months?))", re.IGNORECASE)
_MANDATORY_WORDS = re.compile(r"\b(shall|must|mandatory|required to|has to)\b", re.IGNORECASE)
_PERIOD_WORDS = re.compile(r"\b(last|preceding|previous)\s+\d+\s+(years?|months?)\b", re.IGNORECASE)
_EXEMPTION_MENTION = re.compile(r"\b(mse|msme|startup)\b.{0,40}\bexempt", re.IGNORECASE)
_EXEMPTION_TERMS_DEFINED = re.compile(r"\bexempt(ion|ed)?\b.{0,80}\b(turnover|experience|emd|earnest money)\b", re.IGNORECASE)
_MULTIPLE_THRESHOLD_NUMBERS = re.compile(r"\b\d+(?:\.\d+)?\s*(?:cr|crore|lakh|lac|%)\b", re.IGNORECASE)
_EVIDENCE_HINT = re.compile(r"\b(certificate|certified|document|proof|evidence|declaration|undertaking)\b", re.IGNORECASE)


@dataclass(frozen=True)
class AmbiguityFlag:
    code: str
    question: str
    options: tuple[str, ...] = ()


def detect_ambiguities(clause_text: str) -> list[AmbiguityFlag]:
    flags: list[AmbiguityFlag] = []

    if _FY_MENTION.search(clause_text) and not _COMPLETED_MENTION.search(clause_text):
        flags.append(
            AmbiguityFlag(
                "FY_COMPLETION_UNSPECIFIED",
                "The clause mentions financial years but doesn't say whether they must be completed. "
                "Which financial years should count?",
                ("Last N completed financial years (31 March end-dated before the reference date)", "Last N financial years including the current one"),
            )
        )

    bare_numbers = _BARE_NUMBER_NO_UNIT.findall(clause_text)
    if bare_numbers:
        flags.append(
            AmbiguityFlag(
                "CURRENCY_UNIT_UNCLEAR",
                f"The clause has a number ({bare_numbers[0]}) without a clear unit (₹, Cr, Lakh, %, days, years). What is the unit?",
            )
        )

    if not _MANDATORY_WORDS.search(clause_text):
        flags.append(
            AmbiguityFlag(
                "MANDATORY_UNCLEAR",
                "The clause doesn't use mandatory language (shall/must/required). Is this requirement mandatory or scored?",
                ("Mandatory (pass/fail gate)", "Scored (contributes to the weighted score, not a gate)"),
            )
        )

    if _FY_MENTION.search(clause_text) and not _PERIOD_WORDS.search(clause_text):
        flags.append(
            AmbiguityFlag(
                "PERIOD_UNSPECIFIED",
                "The clause references financial years but doesn't state how many. How many years should be considered?",
            )
        )

    if _EXEMPTION_MENTION.search(clause_text) and not _EXEMPTION_TERMS_DEFINED.search(clause_text):
        flags.append(
            AmbiguityFlag(
                "EXEMPTION_REFERENCED_NOT_DEFINED",
                "The clause references an MSE/MSME/Startup exemption without defining its terms. What exactly is exempted, and under what evidence?",
            )
        )

    threshold_numbers = _MULTIPLE_THRESHOLD_NUMBERS.findall(clause_text)
    if len(threshold_numbers) > 1:
        flags.append(
            AmbiguityFlag(
                "MULTIPLE_THRESHOLDS",
                f"The clause states multiple numeric thresholds ({', '.join(threshold_numbers)}). Which one applies, or do all apply together?",
            )
        )

    if _MANDATORY_WORDS.search(clause_text) and not _EVIDENCE_HINT.search(clause_text):
        flags.append(
            AmbiguityFlag(
                "EVIDENCE_TYPE_UNSPECIFIED",
                "The clause states a requirement but doesn't name the evidence/document that proves it. What document should be required?",
            )
        )

    return flags
