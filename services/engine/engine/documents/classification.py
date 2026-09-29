"""Document type classification (spec §9.2): deterministic keyword signatures, checked against the
declared type from the uploader. LLM classification (step 3 of the spec's order) is deferred —
Phase 3 covers the deterministic path, which is what makes the declared-vs-detected mismatch check
possible without a model call."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Each doc type maps to a list of regexes; the first pattern that matches wins. Order matters:
# more specific signatures are listed before more generic ones that could false-positive on them.
_SIGNATURES: list[tuple[str, list[re.Pattern[str]]]] = [
    ("UDYAM_CERTIFICATE", [re.compile(r"udyam\s+registration\s+certificate", re.I), re.compile(r"udyam-[a-z]{2}-\d{2}-\d{7}", re.I)]),
    ("GST_CERTIFICATE", [re.compile(r"form\s+gst\s+reg-?06", re.I), re.compile(r"goods\s+and\s+services\s+tax.*registration\s+certificate", re.I | re.S)]),
    ("PAN_CARD", [re.compile(r"permanent\s+account\s+number", re.I), re.compile(r"income\s+tax\s+department.{0,40}govt\.?\s+of\s+india", re.I | re.S)]),
    ("INCORPORATION_CERTIFICATE", [re.compile(r"certificate\s+of\s+incorporation", re.I)]),
    ("ITR_ACKNOWLEDGEMENT", [re.compile(r"income\s+tax\s+return.{0,20}acknowledg", re.I | re.S), re.compile(r"\bITR-?V\b")]),
    ("CA_CERTIFICATE_TURNOVER", [re.compile(r"chartered\s+accountant.{0,80}turnover", re.I | re.S), re.compile(r"certify.{0,40}turnover", re.I | re.S)]),
    ("CA_CERTIFICATE_NETWORTH", [re.compile(r"chartered\s+accountant.{0,80}net\s*worth", re.I | re.S), re.compile(r"certify.{0,40}net\s*worth", re.I | re.S)]),
    ("BALANCE_SHEET", [re.compile(r"balance\s+sheet\s+as\s+(at|on)", re.I)]),
    ("PROFIT_AND_LOSS", [re.compile(r"profit\s+(and|&)\s+loss\s+(account|statement)", re.I)]),
    ("BIS_CERTIFICATE", [re.compile(r"bureau\s+of\s+indian\s+standards", re.I), re.compile(r"\bBIS\s+licen[cs]e", re.I)]),
    ("ISO_CERTIFICATE", [re.compile(r"\bISO\s*9001\b"), re.compile(r"\bISO\s*14001\b"), re.compile(r"certificate\s+of\s+registration.{0,60}ISO", re.I | re.S)]),
    ("EPFO_REGISTRATION", [re.compile(r"employees[’']?\s+provident\s+fund", re.I)]),
    ("ESIC_REGISTRATION", [re.compile(r"employees[’']?\s+state\s+insurance", re.I)]),
    ("EXPERIENCE_CERTIFICATE", [re.compile(r"certificate\s+of\s+experience", re.I), re.compile(r"experience\s+letter", re.I)]),
    ("COMPLETION_CERTIFICATE", [re.compile(r"completion\s+certificate", re.I)]),
    ("WORK_ORDER", [re.compile(r"\bwork\s+order\b", re.I), re.compile(r"\bpurchase\s+order\b", re.I)]),
    ("DECLARATION", [re.compile(r"\bdeclaration\b", re.I), re.compile(r"we\s+hereby\s+(declare|undertake)", re.I)]),
    ("AUTHORISATION_LETTER", [re.compile(r"authoris(e|ation)\s+letter", re.I), re.compile(r"authorised\s+signatory", re.I)]),
]


@dataclass(frozen=True)
class ClassificationResult:
    doc_type: str | None
    confidence: float
    matched_pattern: str | None


def classify_by_keywords(text: str) -> ClassificationResult:
    """Deterministic keyword-signature classification (spec §9.2 step 2). Confidence is binary —
    either a signature matched (0.9) or nothing recognisable was found (0.0, doc_type None) —
    matching the spec's own "declared vs detected mismatch" check, which just needs a yes/no."""
    for doc_type, patterns in _SIGNATURES:
        for pattern in patterns:
            if pattern.search(text):
                return ClassificationResult(doc_type=doc_type, confidence=0.9, matched_pattern=pattern.pattern)
    return ClassificationResult(doc_type=None, confidence=0.0, matched_pattern=None)


def declared_vs_detected_mismatch(declared: str | None, detected: ClassificationResult) -> bool:
    """True when the uploader's declared type disagrees with what the text actually looks like —
    triggers a low-severity DOCUMENT_TYPE_MISMATCH exception per spec §9.2/§15.7."""
    if not declared or not detected.doc_type:
        return False
    return declared != detected.doc_type
