from datetime import date

from engine.extraction.financial_years import FinancialYear, last_n_completed_fy, parse_fy_mentions


def test_fy_label_and_dates():
    fy = FinancialYear(start_year=2024)
    assert fy.label == "FY2024-25"
    assert fy.start_date == date(2024, 4, 1)
    assert fy.end_date == date(2025, 3, 31)


def test_fy_is_completed_before_end_date():
    fy = FinancialYear(start_year=2024)  # ends 31 Mar 2025
    assert fy.is_completed(date(2025, 4, 1)) is True
    assert fy.is_completed(date(2025, 3, 31)) is False  # ends ON this date, not before
    assert fy.is_completed(date(2024, 12, 1)) is False


def test_parse_fy_mention_standard_format():
    fys = parse_fy_mentions("Turnover for FY2024-25 was strong.")
    assert fys == [FinancialYear(start_year=2024)]


def test_parse_fy_mention_short_year():
    fys = parse_fy_mentions("F.Y. 2024-25 turnover")
    assert fys == [FinancialYear(start_year=2024)]


def test_parse_ay_converts_to_preceding_fy():
    # Assessment Year 2025-26 corresponds to FY2024-25 (spec §10.3).
    fys = parse_fy_mentions("AY 2025-26 return")
    assert fys == [FinancialYear(start_year=2024)]


def test_parse_multiple_mentions():
    fys = parse_fy_mentions("FY2022-23, FY2023-24 and FY2024-25 turnover figures.")
    assert fys == [FinancialYear(2022), FinancialYear(2023), FinancialYear(2024)]


def test_last_n_completed_fy_mid_year_reference():
    # Reference date 15 Sep 2026 -> current FY is 2026-27 (not yet completed).
    # Last 3 completed: 2023-24, 2024-25, 2025-26.
    result = last_n_completed_fy(3, date(2026, 9, 15))
    assert [fy.label for fy in result] == ["FY2023-24", "FY2024-25", "FY2025-26"]


def test_last_n_completed_fy_on_april_1st():
    # 1 Apr 2026 starts FY2026-27; the just-ended FY2025-26 (31 Mar 2026) IS completed.
    result = last_n_completed_fy(1, date(2026, 4, 1))
    assert result[0].label == "FY2025-26"


def test_last_n_completed_fy_on_march_31st():
    # 31 Mar 2026 is the LAST DAY of FY2025-26 — not yet completed (spec: "< reference_date").
    result = last_n_completed_fy(1, date(2026, 3, 31))
    assert result[0].label == "FY2024-25"
