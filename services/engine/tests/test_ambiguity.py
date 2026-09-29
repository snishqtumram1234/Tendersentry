from engine.rules.ambiguity import detect_ambiguities


def codes(text: str) -> set[str]:
    return {f.code for f in detect_ambiguities(text)}


def test_fy_without_completed_is_flagged():
    assert "FY_COMPLETION_UNSPECIFIED" in codes("The bidder should have turnover in the last 3 financial years.")


def test_fy_with_completed_is_not_flagged():
    assert "FY_COMPLETION_UNSPECIFIED" not in codes("The bidder shall have turnover in the last 3 completed financial years of at least Rs 10 Cr.")


def test_bare_number_without_unit_is_flagged():
    assert "CURRENCY_UNIT_UNCLEAR" in codes("The bidder must have a minimum turnover of 10 in the last 3 completed financial years.")


def test_number_with_unit_is_not_flagged():
    assert "CURRENCY_UNIT_UNCLEAR" not in codes("The bidder must have a minimum turnover of 10 Cr.")


def test_missing_mandatory_language_is_flagged():
    assert "MANDATORY_UNCLEAR" in codes("Bidders with ISO 9001 certification receive additional marks.")


def test_mandatory_language_present_is_not_flagged():
    assert "MANDATORY_UNCLEAR" not in codes("The bidder shall hold a valid GST registration certificate.")


def test_period_unspecified_when_fy_mentioned_without_count():
    assert "PERIOD_UNSPECIFIED" in codes("The bidder must show turnover in financial years preceding the bid.")


def test_exemption_mentioned_without_terms_is_flagged():
    assert "EXEMPTION_REFERENCED_NOT_DEFINED" in codes("MSE bidders are exempt as per government policy.")


def test_exemption_with_terms_is_not_flagged():
    assert "EXEMPTION_REFERENCED_NOT_DEFINED" not in codes("MSE bidders are exempt from the turnover and experience criteria under Udyam registration.")


def test_multiple_thresholds_flagged():
    assert "MULTIPLE_THRESHOLDS" in codes("The bidder must have turnover of 5 Cr or 10 Cr depending on category.")


def test_mandatory_without_evidence_type_is_flagged():
    assert "EVIDENCE_TYPE_UNSPECIFIED" in codes("The bidder shall be registered under the applicable state law.")


def test_mandatory_with_evidence_type_is_not_flagged():
    assert "EVIDENCE_TYPE_UNSPECIFIED" not in codes("The bidder shall submit a valid GST registration certificate.")


def test_clean_clause_produces_no_flags():
    text = "The bidder shall submit a valid PAN card copy as proof of identity."
    flags = detect_ambiguities(text)
    assert flags == []
