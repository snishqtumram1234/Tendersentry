"""Unit tests for engine.extraction.patterns (spec §10.1, §23.1)."""

from engine.extraction.patterns import find_gstin_matches, find_pan_matches, gstin_checksum_ok


def test_gstin_checksum_valid_example():
    # A well-known valid example widely used in GSTIN checksum documentation.
    assert gstin_checksum_ok("27AAPFU0939F1ZV") is True


def test_gstin_checksum_rejects_tampered_value():
    valid = "27AAPFU0939F1ZV"
    tampered = valid[:-1] + ("A" if valid[-1] != "A" else "B")
    assert gstin_checksum_ok(tampered) is False


def test_gstin_checksum_rejects_wrong_length():
    assert gstin_checksum_ok("TOOSHORT") is False


def test_find_pan_matches_extracts_and_validates():
    matches = find_pan_matches("PAN Number: AABCX1234F is the applicant's identifier.")
    assert len(matches) == 1
    assert matches[0].field == "PAN"
    assert matches[0].value == "AABCX1234F"
    assert matches[0].valid is True
    assert matches[0].flags == ()


def test_find_pan_matches_flags_unknown_fourth_character():
    # The 4th character (index 3) must be a known holder-type letter (spec §10.1);
    # 'Z' is not in that set.
    matches = find_pan_matches("AAAZX1234F")
    assert len(matches) == 1
    assert matches[0].valid is False
    assert "PAN_TYPE_UNKNOWN" in matches[0].flags


def test_find_gstin_matches_extracts_valid_gstin():
    matches = find_gstin_matches("GSTIN: 27AAPFU0939F1ZV registered in Maharashtra.")
    assert len(matches) == 1
    assert matches[0].field == "GSTIN"
    assert matches[0].valid is True


def test_find_gstin_matches_flags_bad_checksum():
    # Same shape as a valid GSTIN but with a corrupted check digit.
    matches = find_gstin_matches("27AAPFU0939F1ZX")
    assert len(matches) == 1
    assert matches[0].valid is False
    assert "GSTIN_CHECKSUM_INVALID" in matches[0].flags


def test_no_false_positive_on_plain_text():
    assert find_pan_matches("This is just a normal sentence with no identifiers.") == []
    assert find_gstin_matches("This is just a normal sentence with no identifiers.") == []
