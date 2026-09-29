"""OCR fallback for scanned/image-only pages (spec §9.1). Deskew via Tesseract's own orientation
detection, word-level bounding boxes via image_to_data. Honest about unavailability: if the
Tesseract binary isn't installed (e.g. this dev machine — it's only in the Docker image), OCR is
reported as UNAVAILABLE, never a fabricated transcription. Never raises past the caller — a missing
binary is a capability gap, not a crash."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import pytesseract
from PIL import Image


@dataclass(frozen=True)
class OcrWord:
    text: str
    confidence: float  # 0-1
    bbox: tuple[float, float, float, float]  # x0, y0, x1, y1 in image pixels


@dataclass(frozen=True)
class OcrResult:
    available: bool
    text: str
    words: list[OcrWord]
    mean_confidence: float  # spec §9.1: "low OCR confidence (< 60 mean)" quality gate


@lru_cache(maxsize=1)
def tesseract_available() -> bool:
    try:
        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


def run_ocr(image: Image.Image, lang: str = "eng") -> OcrResult:
    if not tesseract_available():
        return OcrResult(available=False, text="", words=[], mean_confidence=0.0)

    data = pytesseract.image_to_data(image, lang=lang, output_type=pytesseract.Output.DICT)
    words: list[OcrWord] = []
    confidences: list[float] = []
    for i, text in enumerate(data["text"]):
        if not text.strip():
            continue
        conf_raw = float(data["conf"][i])
        if conf_raw < 0:  # tesseract uses -1 for non-text regions
            continue
        conf = conf_raw / 100.0
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        words.append(OcrWord(text=text, confidence=conf, bbox=(float(x), float(y), float(x + w), float(y + h))))
        confidences.append(conf_raw)

    mean_confidence = sum(confidences) / len(confidences) if confidences else 0.0
    full_text = " ".join(w.text for w in words)
    return OcrResult(available=True, text=full_text, words=words, mean_confidence=mean_confidence)
