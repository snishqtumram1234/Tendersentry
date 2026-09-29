"""Real QR generate-then-decode round trip (no mocking — pyzbar's Windows wheel bundles libzbar,
so this runs for real in this environment, unlike the OCR path)."""

import qrcode
from PIL import Image

from engine.documents.qr import decode_qr_codes


def make_qr_image(data: str) -> Image.Image:
    img = qrcode.make(data)
    return img.convert("RGB")


def test_decodes_a_real_qr_code():
    img = make_qr_image("https://verify.example.gov.in/cert/ABC123")
    results = decode_qr_codes(img, page_no=1)
    assert len(results) == 1
    assert results[0].data == "https://verify.example.gov.in/cert/ABC123"
    assert results[0].page_no == 1
    assert results[0].symbology == "QRCODE"


def test_decodes_json_payload():
    payload = '{"cert":"UDYAM-MH-02-1234567","issuer":"MSME"}'
    img = make_qr_image(payload)
    results = decode_qr_codes(img, page_no=3)
    assert results[0].data == payload
    assert results[0].page_no == 3


def test_no_qr_on_blank_page_returns_empty():
    blank = Image.new("RGB", (400, 400), color="white")
    assert decode_qr_codes(blank, page_no=1) == []
