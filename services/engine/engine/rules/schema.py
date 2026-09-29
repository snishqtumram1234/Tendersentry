"""Loads the shared Rule DSL JSON Schema (packages/rule-schema/rule.schema.json — spec §12.1) and
the field registry (spec §12.4). Single source of truth; the API defers schema/semantic validation
to the engine rather than re-implementing this in TypeScript too (Phase 2 deviation — see
docs/PROGRESS.md)."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import jsonschema

# services/engine/engine/rules/schema.py -> ../../../../packages/rule-schema
_REPO_ROOT = Path(__file__).resolve().parents[4]
_SCHEMA_PATH = _REPO_ROOT / "packages" / "rule-schema" / "rule.schema.json"
_FIELDS_PATH = _REPO_ROOT / "packages" / "rule-schema" / "fields.json"


@lru_cache(maxsize=1)
def load_schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_field_registry() -> dict:
    return json.loads(_FIELDS_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _validator() -> jsonschema.Draft7Validator:
    schema = load_schema()
    jsonschema.Draft7Validator.check_schema(schema)
    return jsonschema.Draft7Validator(schema)


def schema_errors(rule_dsl: dict) -> list[str]:
    """Returns a list of human-readable JSON Schema validation errors (empty if valid)."""
    errors = sorted(_validator().iter_errors(rule_dsl), key=lambda e: list(e.path))
    return [f"{'/'.join(str(p) for p in e.path) or '(root)'}: {e.message}" for e in errors]
