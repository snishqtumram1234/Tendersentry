"""Document processing (spec §9.1). Phase 1 built native-text extraction; Phase 3 adds the OCR
fallback for scanned pages, QR decoding, and document-type classification — still a pure function
taking PDF bytes in, structured results out (I/O for OCR/QR happens on in-memory rasterised page
images, not external calls).

Deviation (docs/PROGRESS.md): OCR-derived field bboxes only match a PAN/GSTIN that Tesseract
recognised as a single contiguous word token. A value OCR splits across multiple word boxes (rare
for these formats, but possible on noisy scans) is extracted with the correct value from the OCR
text but without a precise bbox — this is flagged via `bbox is None` rather than guessed.
"""

from __future__ import annotations

from dataclasses import dataclass

import pymupdf as fitz  # the `fitz` module name is deprecated upstream
from PIL import Image

from engine.documents.classification import classify_by_keywords
from engine.documents.ocr import OcrWord, run_ocr
from engine.documents.qr import QrPayload, decode_qr_codes
from engine.extraction.patterns import find_gstin_matches, find_pan_matches

MIN_NATIVE_CHARS = 30  # spec §9.1: "≥ 30 chars of extractable text" heuristic
MIN_OCR_CONFIDENCE = 60.0  # spec §9.1: "low OCR confidence (< 60 mean)" quality gate
RASTER_DPI = 300  # spec §9.1
PDF_POINTS_PER_INCH = 72.0


@dataclass(frozen=True)
class Bbox:
    x0: float
    y0: float
    x1: float
    y1: float


@dataclass(frozen=True)
class ExtractedFieldResult:
    field: str
    value_raw: str
    page_no: int  # 1-indexed
    bbox: Bbox | None
    confidence: float
    method: str  # NATIVE_REGEX | OCR_REGEX
    valid: bool
    flags: list[str]


@dataclass(frozen=True)
class PageResult:
    page_no: int
    text_source: str  # NATIVE | OCR | NONE
    char_count: int
    ocr_confidence: float | None


@dataclass(frozen=True)
class ProcessResult:
    page_count: int
    text_layer: str  # NATIVE | OCR | MIXED | NONE
    pages: list[PageResult]
    fields: list[ExtractedFieldResult]
    qr_payloads: list[QrPayload]
    doc_type: str | None
    doc_type_confidence: float
    failure_code: str | None  # DOCUMENT_UNREADABLE | DOCUMENT_ENCRYPTED | None


def extract_native_page_texts(data: bytes) -> list[str]:
    """Just the per-page plain text (native pages only; scanned pages come back empty) — used by
    tender clause segmentation (spec §11.1), which doesn't need bbox/field extraction."""
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        if doc.is_encrypted:
            return []
        return [doc.load_page(i).get_text() or "" for i in range(doc.page_count)]
    finally:
        doc.close()


def _rasterize(page: "fitz.Page") -> Image.Image:
    pix = page.get_pixmap(dpi=RASTER_DPI)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _ocr_word_bbox(words: list[OcrWord], value: str) -> Bbox | None:
    """Finds a single OCR word matching `value` exactly and converts its pixel bbox to PDF points
    at 1x scale (matching the native-text path's coordinate space — spec §9.1's viewer overlay
    depends on both paths agreeing on units)."""
    scale = PDF_POINTS_PER_INCH / RASTER_DPI
    for w in words:
        if w.text == value:
            x0, y0, x1, y1 = w.bbox
            return Bbox(x0=x0 * scale, y0=y0 * scale, x1=x1 * scale, y1=y1 * scale)
    return None


def process_pdf_bytes(data: bytes, ocr_lang: str = "eng") -> ProcessResult:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return ProcessResult(page_count=0, text_layer="NONE", pages=[], fields=[], qr_payloads=[], doc_type=None, doc_type_confidence=0.0, failure_code="DOCUMENT_UNREADABLE")

    try:
        if doc.is_encrypted:
            return ProcessResult(page_count=0, text_layer="NONE", pages=[], fields=[], qr_payloads=[], doc_type=None, doc_type_confidence=0.0, failure_code="DOCUMENT_ENCRYPTED")

        pages: list[PageResult] = []
        fields: list[ExtractedFieldResult] = []
        qr_payloads: list[QrPayload] = []
        classify_text_parts: list[str] = []
        any_readable = False

        for i in range(doc.page_count):
            page = doc.load_page(i)
            native_text = page.get_text() or ""
            has_native = len(native_text.strip()) >= MIN_NATIVE_CHARS

            image = _rasterize(page)
            qr_payloads.extend(decode_qr_codes(image, page_no=i + 1))

            text_source = "NATIVE"
            effective_text = native_text
            ocr_confidence: float | None = None
            ocr_words: list[OcrWord] = []

            if not has_native:
                ocr_result = run_ocr(image, lang=ocr_lang)
                if ocr_result.available and ocr_result.mean_confidence >= MIN_OCR_CONFIDENCE and len(ocr_result.text.strip()) >= MIN_NATIVE_CHARS:
                    text_source = "OCR"
                    effective_text = ocr_result.text
                    ocr_confidence = ocr_result.mean_confidence
                    ocr_words = ocr_result.words
                else:
                    text_source = "NONE"
                    effective_text = ""

            pages.append(PageResult(page_no=i + 1, text_source=text_source, char_count=len(effective_text), ocr_confidence=ocr_confidence))
            if text_source == "NONE":
                continue
            any_readable = True
            classify_text_parts.append(effective_text)

            for match in [*find_pan_matches(effective_text), *find_gstin_matches(effective_text)]:
                bbox: Bbox | None = None
                method = "NATIVE_REGEX" if text_source == "NATIVE" else "OCR_REGEX"
                if text_source == "NATIVE":
                    rects = page.search_for(match.value)
                    if rects:
                        r = rects[0]
                        bbox = Bbox(x0=r.x0, y0=r.y0, x1=r.x1, y1=r.y1)
                else:
                    bbox = _ocr_word_bbox(ocr_words, match.value)

                base_confidence = 1.0 if match.valid else 0.6
                # OCR-sourced fields never exceed the page's own OCR confidence (spec §10.6:
                # "extraction confidence" reflects the whole pipeline, not just pattern validity).
                confidence = base_confidence if text_source == "NATIVE" else min(base_confidence, (ocr_confidence or 0) / 100.0)

                fields.append(
                    ExtractedFieldResult(
                        field=match.field,
                        value_raw=match.value,
                        page_no=i + 1,
                        bbox=bbox,
                        confidence=confidence,
                        method=method,
                        valid=match.valid,
                        flags=list(match.flags),
                    )
                )

        if not pages:
            text_layer = "NONE"
        else:
            sources = {p.text_source for p in pages if p.text_source != "NONE"}
            if not sources:
                text_layer = "NONE"
            elif sources == {"NATIVE"}:
                text_layer = "NATIVE"
            elif sources == {"OCR"}:
                text_layer = "OCR"
            else:
                text_layer = "MIXED"

        classification = classify_by_keywords(" ".join(classify_text_parts)) if any_readable else classify_by_keywords("")

        return ProcessResult(
            page_count=len(pages),
            text_layer=text_layer,
            pages=pages,
            fields=fields,
            qr_payloads=qr_payloads,
            doc_type=classification.doc_type,
            doc_type_confidence=classification.confidence,
            failure_code=None,
        )
    finally:
        doc.close()
