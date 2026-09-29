from engine.rules.segmentation import segment_pages


def test_splits_on_numbered_headings():
    pages = [
        "7.1 Valid GST registration\nThe bidder shall hold a valid GST registration.\n"
        "7.2 Average annual turnover\nThe bidder must have average turnover of at least Rs 10 Cr."
    ]
    clauses = segment_pages(pages)
    assert [c.clause_ref for c in clauses] == ["7.1", "7.2"]
    assert "GST registration" in clauses[0].text
    assert "turnover" in clauses[1].text


def test_candidate_detection_flags_requirement_like_clauses():
    pages = ["9.1 Background\nThis tender concerns street lighting.\n9.2 Eligibility\nThe bidder shall have a valid PAN."]
    clauses = segment_pages(pages)
    background = next(c for c in clauses if c.clause_ref == "9.1")
    eligibility = next(c for c in clauses if c.clause_ref == "9.2")
    assert eligibility.is_requirement_candidate is True
    assert background.is_requirement_candidate is False


def test_tracks_page_span_across_pages():
    pages = ["7.1 Long clause\nStarts here on page 1 and shall continue.", "still going, must finish here."]
    clauses = segment_pages(pages)
    assert clauses[0].page_start == 1
    assert clauses[0].page_end == 2


def test_page_with_no_headings_still_produces_a_clause():
    pages = ["Just some free text with no numbered heading at all."]
    clauses = segment_pages(pages)
    assert len(clauses) == 1
    assert clauses[0].text.startswith("Just some free text")


def test_empty_pages_produce_no_clauses():
    assert segment_pages([]) == []
    assert segment_pages(["", "   "]) == []
