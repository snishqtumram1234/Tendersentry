"""Tender clause segmentation and candidate-requirement detection (spec §11.1). Works on the
per-page native text already produced by the document pipeline (services/engine/engine/documents/
pipeline.py) — segmentation itself needs no additional I/O, so this stays a pure function too."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Numbered headings: "7.2 Turnover", "7.2. Turnover", "(a) ...", "Clause 7.2 ..."
_HEADING_RE = re.compile(r"^(?:(\d+(?:\.\d+)*)\.?\s+|\(([a-z])\)\s+|Clause\s+(\d+(?:\.\d+)*)\s*[-:]?\s*)(.*)$")

_CANDIDATE_KEYWORDS = (
    "shall",
    "must",
    "minimum",
    "not less than",
    "eligible",
    "eligibility",
    "turnover",
    "experience",
    "certificate",
    "certification",
    "registered",
    "registration",
    "declaration",
    "mse",
    "debar",
    "exemption",
    "pan",
    "gstin",
    "udyam",
)


@dataclass(frozen=True)
class Clause:
    clause_ref: str
    heading: str | None
    text: str
    page_start: int
    page_end: int
    is_requirement_candidate: bool


def _looks_like_candidate(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in _CANDIDATE_KEYWORDS)


def segment_pages(pages: list[str]) -> list[Clause]:
    """`pages` is one plain-text string per page (1-indexed by position). Splits on numbered
    headings; a page with no headings at all becomes one clause covering the whole page (better to
    keep an ungrouped block than silently drop text)."""
    clauses: list[Clause] = []
    current_ref: str | None = None
    current_heading: str | None = None
    current_lines: list[str] = []
    current_page_start = 1

    def flush(end_page: int) -> None:
        if current_ref is None and not current_lines:
            return
        text = "\n".join(current_lines).strip()
        if not text:
            return
        clauses.append(
            Clause(
                clause_ref=current_ref or f"p{current_page_start}",
                heading=current_heading,
                text=text,
                page_start=current_page_start,
                page_end=end_page,
                is_requirement_candidate=_looks_like_candidate(text),
            )
        )

    for page_no, page_text in enumerate(pages, start=1):
        for raw_line in page_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            m = _HEADING_RE.match(line)
            if m:
                flush(page_no)
                ref = m.group(1) or m.group(2) or m.group(3) or ""
                rest = m.group(4).strip()
                current_ref = ref
                current_heading = rest[:120] if rest else None
                current_lines = [rest] if rest else []
                current_page_start = page_no
            else:
                if current_ref is None and not current_lines:
                    current_page_start = page_no
                current_lines.append(line)

    flush(len(pages) if pages else current_page_start)
    return clauses
