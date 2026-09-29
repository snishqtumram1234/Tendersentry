from engine.documents.classification import classify_by_keywords, declared_vs_detected_mismatch


def test_classifies_pan_card():
    r = classify_by_keywords("INCOME TAX DEPARTMENT\nGOVT. OF INDIA\nPERMANENT ACCOUNT NUMBER\nAABCX1234F")
    assert r.doc_type == "PAN_CARD"
    assert r.confidence > 0


def test_classifies_udyam_certificate():
    r = classify_by_keywords("UDYAM REGISTRATION CERTIFICATE\nUDYAM-MH-02-1234567")
    assert r.doc_type == "UDYAM_CERTIFICATE"


def test_classifies_gst_certificate():
    r = classify_by_keywords("FORM GST REG-06\nRegistration Certificate")
    assert r.doc_type == "GST_CERTIFICATE"


def test_classifies_incorporation_certificate():
    r = classify_by_keywords("CERTIFICATE OF INCORPORATION\nCIN: U12345MH2020PTC123456")
    assert r.doc_type == "INCORPORATION_CERTIFICATE"


def test_classifies_iso_certificate():
    r = classify_by_keywords("Certificate of Registration\nISO 9001:2015 Quality Management System")
    assert r.doc_type == "ISO_CERTIFICATE"


def test_unrecognised_text_returns_none():
    r = classify_by_keywords("Just some ordinary correspondence with no special markers.")
    assert r.doc_type is None
    assert r.confidence == 0.0


def test_declared_matches_detected_no_mismatch():
    detected = classify_by_keywords("PERMANENT ACCOUNT NUMBER card")
    assert declared_vs_detected_mismatch("PAN_CARD", detected) is False


def test_declared_disagrees_with_detected_is_a_mismatch():
    detected = classify_by_keywords("UDYAM REGISTRATION CERTIFICATE")
    assert declared_vs_detected_mismatch("PAN_CARD", detected) is True


def test_no_mismatch_flagged_when_detection_is_inconclusive():
    detected = classify_by_keywords("ordinary text")
    assert declared_vs_detected_mismatch("PAN_CARD", detected) is False


def test_no_mismatch_flagged_when_nothing_was_declared():
    detected = classify_by_keywords("UDYAM REGISTRATION CERTIFICATE")
    assert declared_vs_detected_mismatch(None, detected) is False
