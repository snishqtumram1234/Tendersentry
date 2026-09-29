"""Semantic validation beyond what JSON Schema alone can express (spec §12.5): unit compatibility,
periodic fields must have a period, and a depth/node-count cap so a malformed or adversarial DSL
document can't blow up the (future, Phase 4) interpreter."""

from __future__ import annotations

from engine.rules.schema import load_field_registry

MAX_DEPTH = 8
MAX_NODES = 64


def _walk(node: object, depth: int, errors: list[str], counter: list[int]) -> str | None:
    """Returns the inferred unit of a value node ('INR'|'COUNT'|'PERCENT'|'DAYS'|'YEARS'|None), or
    None for boolean/series nodes and constants without a declared unit."""
    counter[0] += 1
    if counter[0] > MAX_NODES:
        errors.append(f"rule exceeds the maximum of {MAX_NODES} nodes")
        return None
    if depth > MAX_DEPTH:
        errors.append(f"rule exceeds the maximum nesting depth of {MAX_DEPTH}")
        return None
    if not isinstance(node, dict):
        return None

    kind = node.get("node")
    registry = load_field_registry()

    if kind in ("AND", "OR"):
        for arg in node.get("args", []):
            _walk(arg, depth + 1, errors, counter)
        return None
    if kind == "NOT":
        _walk(node.get("arg"), depth + 1, errors, counter)
        return None
    if kind == "IF":
        _walk(node.get("cond"), depth + 1, errors, counter)
        _walk(node.get("then"), depth + 1, errors, counter)
        if "else" in node:
            _walk(node.get("else"), depth + 1, errors, counter)
        return None
    if kind == "COMPARE":
        left_unit = _walk(node.get("left"), depth + 1, errors, counter)
        right_unit = _walk(node.get("right"), depth + 1, errors, counter)
        if left_unit and right_unit and left_unit != right_unit:
            errors.append(f"COMPARE mixes incompatible units: {left_unit} vs {right_unit}")
        return None
    if kind in ("DOCUMENT_EXISTS", "DATE_VALIDITY", "ENTITY_MATCH", "SOURCE_VERIFIED", "CLAIM_TRUE", "TENDER_FLAG", "FIELD_MATCH"):
        return None
    if kind == "THRESHOLD_COUNT":
        _walk(node.get("series"), depth + 1, errors, counter)
        _walk(node.get("value"), depth + 1, errors, counter)
        return None

    if kind == "CONST":
        return node.get("unit")
    if kind == "AGG":
        return _walk(node.get("series"), depth + 1, errors, counter)
    if kind in ("RATIO",):
        _walk(node.get("num"), depth + 1, errors, counter)
        _walk(node.get("den"), depth + 1, errors, counter)
        return None  # a ratio of two same-unit values is dimensionless
    if kind == "PERCENTAGE":
        _walk(node.get("part"), depth + 1, errors, counter)
        _walk(node.get("whole"), depth + 1, errors, counter)
        return "PERCENT"
    if kind == "FIELD":
        claim_type = node.get("claim_type")
        entry = registry.get(claim_type, {})
        if entry.get("periodic") and not node.get("period"):
            errors.append(f"FIELD({claim_type}) is a periodic value and must specify a period")
        return entry.get("unit")

    if kind in ("SERIES", "TOP_N", "FILTER"):
        if kind == "SERIES":
            claim_type = node.get("claim_type")
            entry = registry.get(claim_type, {})
            if entry.get("periodic") and not node.get("period"):
                errors.append(f"SERIES({claim_type}) is a periodic value and must specify a period")
            return entry.get("unit")
        if kind == "TOP_N":
            return _walk(node.get("series"), depth + 1, errors, counter)
        if kind == "FILTER":
            series_unit = _walk(node.get("series"), depth + 1, errors, counter)
            _walk(node.get("value"), depth + 1, errors, counter)
            return series_unit

    return None


def semantic_errors(rule_dsl: dict) -> list[str]:
    errors: list[str] = []
    counter = [0]
    _walk(rule_dsl.get("expression"), 1, errors, counter)
    for exemption in rule_dsl.get("exemptions", []):
        _walk(exemption.get("when"), 1, errors, counter)
    if rule_dsl.get("mandatory") is False and "weight" not in rule_dsl:
        errors.append("non-mandatory rules must specify a weight (spec §11.4)")
    return errors
