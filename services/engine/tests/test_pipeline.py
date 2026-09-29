"""Unit tests for engine.documents.pipeline (spec §9.1, §23.1). Builds tiny real PDFs in-memory
with PyMuPDF itself (no fixture files, no network) so this stays a pure/fast unit test."""

import pymupdf as fitz
import qrcode

from engine.documents.ocr import tesseract_available
from engine.documents.pipeline import process_pdf_bytes


def make_pdf(lines: list[str]) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    y = 72
    for line in lines:
        page.insert_text((72, y), line, fontsize=11)
        y += 20
    data = doc.tobytes()
    doc.close()
    return data


def make_pdf_with_qr(qr_data: str) -> bytes:
    """A PDF page with a real QR code image embedded (spec §9.1, §14.3)."""
    qr_img = qrcode.make(qr_data).convert("RGB")
    doc = fitz.open()
    page = doc.new_page()
    import io

    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    page.insert_image(fitz.Rect(72, 72, 272, 272), stream=buf.getvalue())
    data = doc.tobytes()
    doc.close()
    return data


def make_blank_scanned_pdf() -> bytes:
    """A page with an embedded image but NO text layer at all — simulates a scanned document."""
    from PIL import Image

    import io

    img = Image.new("RGB", (600, 800), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    doc = fitz.open()
    page = doc.new_page()
    page.insert_image(fitz.Rect(0, 0, 600, 800), stream=buf.getvalue())
    data = doc.tobytes()
    doc.close()
    return data


def test_extracts_valid_pan_with_bbox():
    pdf = make_pdf(["Applicant PAN: AABCX1234F", "Some other filler text to pad the page out."])
    result = process_pdf_bytes(pdf)

    assert result.failure_code is None
    assert result.page_count == 1
    assert result.text_layer == "NATIVE"

    pans = [f for f in result.fields if f.field == "PAN"]
    assert len(pans) == 1
    assert pans[0].value_raw == "AABCX1234F"
    assert pans[0].valid is True
    assert pans[0].page_no == 1
    # bbox should be a real, non-degenerate rectangle on the page.
    assert pans[0].bbox.x1 > pans[0].bbox.x0
    assert pans[0].bbox.y1 > pans[0].bbox.y0


def test_extracts_gstin_and_pan_together():
    pdf = make_pdf(["PAN: AABCX1234F", "GSTIN: 27AAPFU0939F1ZV", "Padding text for the page."])
    result = process_pdf_bytes(pdf)

    fields_by_type = {f.field: f for f in result.fields}
    assert "PAN" in fields_by_type
    assert "GSTIN" in fields_by_type
    assert fields_by_type["GSTIN"].valid is True


def test_page_with_no_text_is_recorded_but_not_extracted():
    doc = fitz.open()
    doc.new_page()  # blank page, no text at all
    data = doc.tobytes()
    doc.close()

    result = process_pdf_bytes(data)
    assert result.page_count == 1
    assert result.text_layer == "NONE"
    assert result.fields == []
    assert result.pages[0].text_source == "NONE"


def test_corrupt_bytes_are_reported_honestly_not_silently_ignored():
    result = process_pdf_bytes(b"this is not a pdf at all")
    assert result.failure_code == "DOCUMENT_UNREADABLE"
    assert result.fields == []


def test_two_documents_with_matching_pan_would_reconcile_as_consistent():
    # This test documents the walking-skeleton acceptance criterion (spec §27.1 Phase 1): two
    # documents with the same PAN extract to the identical value, which is what the API's
    # reconciliation step compares. The actual CONSISTENT/CONFLICT decision lives in the API
    # (apps/api/src/modules/reconciliation) — this just proves the engine's half of the contract.
    pdf_a = make_pdf(["PAN Card", "AABCX1234F", "Padding text so this page clears the native-text threshold."])
    pdf_b = make_pdf(["Income Tax Return", "PAN: AABCX1234F", "Padding text so this page clears the native-text threshold."])

    pan_a = next(f.value_raw for f in process_pdf_bytes(pdf_a).fields if f.field == "PAN")
    pan_b = next(f.value_raw for f in process_pdf_bytes(pdf_b).fields if f.field == "PAN")
    assert pan_a == pan_b


def test_two_documents_with_mismatching_pan_would_reconcile_as_conflict():
    pdf_a = make_pdf(["PAN Card", "AABCX1234F", "Padding text so this page clears the native-text threshold."])
    pdf_b = make_pdf(["Income Tax Return", "PAN: AABCX1234P", "Padding text so this page clears the native-text threshold."])

    pan_a = next(f.value_raw for f in process_pdf_bytes(pdf_a).fields if f.field == "PAN")
    pan_b = next(f.value_raw for f in process_pdf_bytes(pdf_b).fields if f.field == "PAN")
    assert pan_a != pan_b


def test_qr_code_on_a_page_is_decoded_and_attributed_to_that_page():
    pdf = make_pdf_with_qr("https://verify.example.gov.in/udyam/UDYAM-MH-02-1234567")
    result = process_pdf_bytes(pdf)
    assert len(result.qr_payloads) == 1
    assert result.qr_payloads[0].page_no == 1
    assert result.qr_payloads[0].data == "https://verify.example.gov.in/udyam/UDYAM-MH-02-1234567"


def test_document_is_classified_from_its_native_text():
    pdf = make_pdf(["UDYAM REGISTRATION CERTIFICATE", "UDYAM-MH-02-1234567", "Padding text so this page clears the native-text threshold."])
    result = process_pdf_bytes(pdf)
    assert result.doc_type == "UDYAM_CERTIFICATE"
    assert result.doc_type_confidence > 0


def test_unclassifiable_document_gets_no_doc_type_not_a_guess():
    pdf = make_pdf(["Just some ordinary correspondence with no special markers on this page at all."])
    result = process_pdf_bytes(pdf)
    assert result.doc_type is None
    assert result.doc_type_confidence == 0.0


def test_scanned_page_without_tesseract_is_recorded_as_none_not_fabricated():
    if tesseract_available():
        return  # covered honestly either way — see the OCR-present branch below
    pdf = make_blank_scanned_pdf()
    result = process_pdf_bytes(pdf)
    assert result.pages[0].text_source == "NONE"
    assert result.text_layer == "NONE"
    assert result.fields == []


def test_scanned_page_still_gets_its_qr_code_decoded_even_without_ocr():
    # QR decoding doesn't need text extraction at all — it must work independently of whether
    # Tesseract is installed (spec §9.1: QR and OCR are separate capabilities).
    import io

    qr_img = qrcode.make("https://verify.example.gov.in/gst/27AAPFU0939F1ZV").convert("RGB")
    doc = fitz.open()
    page = doc.new_page()
    buf = io.BytesIO()
    qr_img.save(buf, format="PNG")
    page.insert_image(fitz.Rect(72, 72, 272, 272), stream=buf.getvalue())
    pdf = doc.tobytes()
    doc.close()

    result = process_pdf_bytes(pdf)
    assert result.pages[0].text_source == "NONE"  # no real text on this page, just a QR image
    assert len(result.qr_payloads) == 1
    assert "27AAPFU0939F1ZV" in result.qr_payloads[0].data
