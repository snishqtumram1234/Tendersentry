from decimal import Decimal

from engine.extraction.money import format_inr, parse_money


def test_parses_rupee_symbol_with_indian_grouping():
    m = parse_money("₹ 10,00,00,000")
    assert m is not None
    assert m.amount == Decimal("100000000")


def test_parses_rs_with_crore_word():
    m = parse_money("Rs. 10 Cr.")
    assert m.amount == Decimal("100000000")


def test_parses_inr_plain():
    m = parse_money("INR 100000000")
    assert m.amount == Decimal("100000000")


def test_parses_bare_crore():
    m = parse_money("10 Crore")
    assert m.amount == Decimal("100000000")


def test_parses_lakh():
    m = parse_money("1.5 lakh")
    assert m.amount == Decimal("150000")


def test_parses_lakhs_plural():
    m = parse_money("15 Lakhs")
    assert m.amount == Decimal("1500000")


def test_parses_trailing_slash_dash():
    m = parse_money("₹10,00,00,000/-")
    assert m.amount == Decimal("100000000")

    m2 = parse_money("Rs.10 Cr.")
    assert m2.amount == Decimal("100000000")


def test_parenthesised_amount_is_negative():
    m = parse_money("(50,000)")
    assert m.amount == Decimal("-50000")


def test_decimal_in_crore_table_cell():
    m = parse_money("12.50")
    assert m.amount == Decimal("12.50")


def test_no_amount_returns_none():
    assert parse_money("no numbers here") is None


def test_format_inr_indian_grouping():
    assert format_inr(Decimal("100000000")) == "₹10,00,00,000"
    assert format_inr(Decimal("1234567")) == "₹12,34,567"
    assert format_inr(Decimal("500")) == "₹500"


def test_format_inr_negative():
    assert format_inr(Decimal("-500")) == "-₹500"
