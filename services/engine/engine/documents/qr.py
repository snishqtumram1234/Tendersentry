"""QR code decoding (spec §9.1, §14.3). Decodes whatever payload is on the page image — the engine
never verifies it here; that's the QR verification adapter's job (Phase 5). This module just gets
the raw decoded text/bytes out, honestly, with a real page-no/type per payload."""

from __future__ import annotations

from dataclasses import dataclass

from PIL import Image
from pyzbar.pyzbar import decode as zbar_decode


@dataclass(frozen=True)
class QrPayload:
    page_no: int
    data: str
    symbology: str


def decode_qr_codes(image: Image.Image, page_no: int) -> list[QrPayload]:
    """Decodes every QR/barcode symbol found on one rasterised page image."""
    results = []
    for symbol in zbar_decode(image):
        if symbol.type != "QRCODE":
            continue
        try:
            data = symbol.data.decode("utf-8")
        except UnicodeDecodeError:
            data = symbol.data.decode("latin-1", errors="replace")
        results.append(QrPayload(page_no=page_no, data=data, symbology=symbol.type))
    return results
