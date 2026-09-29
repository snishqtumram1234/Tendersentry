"""Deterministic plain-English rendering from the DSL (spec §11.5: "a template renderer, not the
LLM" — the officer must be able to trust this text is a faithful description of what will actually
run, not a second AI guess)."""

from __future__ import annotations

UNIT_WORDS = {"INR": "", "COUNT": "", "PERCENT": "%", "DAYS": "days", "YEARS": "years"}

OP_WORDS = {">=": "at least", ">": "more than", "<=": "at most", "<": "less than", "==": "equal to", "!=": "not equal to"}


def _op_word(op: object) -> str:
    return OP_WORDS.get(str(op), str(op))

PERIOD_WORDS = {
    "LAST_N_COMPLETED_FY": lambda p: f"the last {p.get('n', '?')} completed financial years",
    "FY_LIST": lambda p: "financial years " + ", ".join(p.get("fys", [])),
    "LAST_N_YEARS_FROM_REFERENCE": lambda p: f"the last {p.get('n', '?')} years",
    "ALL": lambda p: "all available periods",
}


def _fmt_amount(value: str, unit: str | None) -> str:
    if unit == "INR":
        try:
            n = float(value)
        except (TypeError, ValueError):
            return value
        if n >= 1e7:
            return f"₹{n / 1e7:g} Cr"
        if n >= 1e5:
            return f"₹{n / 1e5:g} Lakh"
        return f"₹{n:g}"
    return f"{value}{UNIT_WORDS.get(unit or '', '')}"


def _value(node: dict) -> str:
    kind = node.get("node")
    if kind == "CONST":
        return _fmt_amount(str(node.get("value")), node.get("unit"))
    if kind == "AGG":
        fn = node.get("fn", "?").lower()
        return f"the {fn} of {_series(node.get('series', {}))}"
    if kind == "RATIO":
        return f"the ratio of {_value(node.get('num', {}))} to {_value(node.get('den', {}))}"
    if kind == "PERCENTAGE":
        return f"{_value(node.get('part', {}))} as a percentage of {_value(node.get('whole', {}))}"
    if kind == "FIELD":
        claim = node.get("claim_type", "?")
        period = node.get("period")
        suffix = f" in {_period(period)}" if period else ""
        return f"{claim.replace('_', ' ').title()}{suffix}"
    return "an unrecognised value"


def _period(period: dict | None) -> str:
    if not period:
        return "the applicable period"
    fn = PERIOD_WORDS.get(str(period.get("kind")))
    return fn(period) if fn else "the applicable period"


def _series(node: dict) -> str:
    kind = node.get("node")
    if kind == "SERIES":
        return f"{node.get('claim_type', '?').replace('_', ' ').title()} over {_period(node.get('period'))}"
    if kind == "TOP_N":
        order = "highest" if node.get("order") == "DESC" else "lowest"
        return f"the {node.get('n', '?')} {order} values of {_series(node.get('series', {}))}"
    if kind == "FILTER":
        return f"{_series(node.get('series', {}))} where the value is {_op_word(node.get('op'))} {_value(node.get('value', {}))}"
    return "an unrecognised series"


def _boolean(node: dict) -> str:
    kind = node.get("node")
    if kind == "AND":
        return " and ".join(_boolean(a) for a in node.get("args", []))
    if kind == "OR":
        return " or ".join(f"({_boolean(a)})" for a in node.get("args", []))
    if kind == "NOT":
        return f"not ({_boolean(node.get('arg', {}))})"
    if kind == "IF":
        base = f"if {_boolean(node.get('cond', {}))}, then {_boolean(node.get('then', {}))}"
        if "else" in node:
            base += f", otherwise {_boolean(node.get('else', {}))}"
        return base
    if kind == "COMPARE":
        return f"{_value(node.get('left', {}))} must be {_op_word(node.get('op'))} {_value(node.get('right', {}))}"
    if kind == "DOCUMENT_EXISTS":
        n = node.get("min_count", 1)
        plural = "s" if n != 1 else ""
        return f"at least {n} {node.get('doc_type', '?').replace('_', ' ').title()} document{plural} must be provided"
    if kind == "DATE_VALIDITY":
        return f"the {node.get('doc_type', '?').replace('_', ' ').title()} must be valid on {node.get('valid_on', 'the reference date')}"
    if kind == "FIELD_MATCH":
        return f"{node.get('field', '?').replace('_', ' ').title()} must be consistent across submitted documents"
    if kind == "ENTITY_MATCH":
        return f"the {node.get('entity', '?').replace('_', ' ').lower()} must match across documents"
    if kind == "SOURCE_VERIFIED":
        return f"{node.get('claim_type', '?').replace('_', ' ').title()} must be verified to at least {node.get('min_status', '?').replace('_', ' ').lower()}"
    if kind == "THRESHOLD_COUNT":
        n = node.get("min_count", "?")
        return f"at least {n} entries of {_series(node.get('series', {}))} must be {_op_word(node.get('op'))} {_value(node.get('value', {}))}"
    if kind == "CLAIM_TRUE":
        return f"{node.get('claim_type', '?').replace('_', ' ').title()} must be affirmed"
    if kind == "TENDER_FLAG":
        return f"tender flag '{node.get('flag', '?')}' must be set"
    return "an unrecognised condition"


def render_plain_english(rule_dsl: dict) -> str:
    """Renders a complete sentence from the DSL's expression. Never raises — an unrecognised node
    shape renders as an honest placeholder rather than crashing the rule review screen."""
    try:
        text = _boolean(rule_dsl.get("expression", {})).strip()
        if not text:
            raise ValueError("empty render")
        return text[0].upper() + text[1:] + "."
    except Exception:
        return "This rule could not be rendered to plain English — review the structured JSON directly."
