"""OCR tests. `tesseract_available()` is genuinely False in this dev environment (the binary is
only installed in the Docker image — see Dockerfile), so the primary assertion here is the honest
degradation path: run_ocr must report unavailability, never fabricate a transcription. If a future
environment DOES have tesseract on PATH, the second test exercises the real decode instead — either
way, this file proves the behaviour that actually applies wherever it runs."""

from PIL import Image, ImageDraw

from engine.documents.ocr import run_ocr, tesseract_available


def test_ocr_reports_unavailable_honestly_when_tesseract_is_missing():
    if tesseract_available():
        return  # covered by the other test in an environment that has tesseract
    img = Image.new("RGB", (200, 50), color="white")
    result = run_ocr(img)
    assert result.available is False
    assert result.text == ""
    assert result.words == []
    assert result.mean_confidence == 0.0


def test_ocr_extracts_real_text_when_tesseract_is_present():
    if not tesseract_available():
        return  # this machine doesn't have it — see the other test
    img = Image.new("RGB", (400, 100), color="white")
    draw = ImageDraw.Draw(img)
    draw.text((10, 10), "HELLO WORLD", fill="black")
    result = run_ocr(img)
    assert result.available is True
    assert "HELLO" in result.text.upper()
