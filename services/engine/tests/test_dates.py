from datetime import date

from engine.extraction.dates import find_dates


def test_iso_date():
    matches = find_dates("Issued on 2025-03-12.")
    assert matches[0].value == date(2025, 3, 12)
    assert matches[0].confidence == 1.0


def test_textual_date_with_ordinal():
    matches = find_dates("Valid from 12th March, 2025.")
    assert matches[0].value == date(2025, 3, 12)


def test_textual_date_short_month():
    matches = find_dates("12 Mar 2025")
    assert matches[0].value == date(2025, 3, 12)


def test_numeric_day_first_default():
    # Both <=12: genuinely ambiguous, day-first (Indian) default, lower confidence.
    matches = find_dates("01/02/2025")
    assert matches[0].value == date(2025, 2, 1)
    assert matches[0].confidence == 0.85


def test_numeric_unambiguous_when_first_number_exceeds_12():
    matches = find_dates("25/03/2025")
    assert matches[0].value == date(2025, 3, 25)
    assert matches[0].confidence == 1.0


def test_numeric_unambiguous_when_second_number_exceeds_12():
    matches = find_dates("03/25/2025")
    assert matches[0].value == date(2025, 3, 25)
    assert matches[0].confidence == 1.0


def test_dash_and_dot_separators():
    assert find_dates("12-03-2025")[0].value == date(2025, 3, 12)
    assert find_dates("12.03.2025")[0].value == date(2025, 3, 12)


def test_invalid_date_is_skipped_not_crashed():
    assert find_dates("32/13/2025") == []


def test_no_date_in_text():
    assert find_dates("no dates here at all") == []


def test_multiple_dates_in_one_text():
    matches = find_dates("Issued 01/04/2024, valid until 31/03/2025.")
    assert len(matches) == 2
    assert matches[0].value == date(2024, 4, 1)
    assert matches[1].value == date(2025, 3, 31)
