"""Scalar helpers shared by the interpreter: pulling a Decimal out of whatever shape a claim's
JSON `value` happens to have, truthiness for boolean-ish claims, and the six comparison operators."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


def to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool):  # bool is an int subclass — reject before the int branch
        return None
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, Decimal):
        return value
    if isinstance(value, str):
        try:
            return Decimal(value)
        except InvalidOperation:
            return None
    if isinstance(value, dict):
        for key in ("value", "amount"):
            if key in value:
                return to_decimal(value[key])
        return None
    return None


def bool_from_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("true", "yes", "1")
    if isinstance(value, dict):
        if "affirmed" in value:
            return bool(value["affirmed"])
        if "value" in value:
            return bool_from_value(value["value"])
    return bool(value)


_OPS = {
    ">=": lambda a, b: a >= b,
    ">": lambda a, b: a > b,
    "<=": lambda a, b: a <= b,
    "<": lambda a, b: a < b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}


def compare(op: str, left: Decimal, right: Decimal) -> bool:
    return _OPS[op](left, right)


def dec_str(value: Decimal | None) -> str | None:
    return None if value is None else str(value)
