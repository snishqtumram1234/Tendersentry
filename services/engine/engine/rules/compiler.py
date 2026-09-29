"""LLM rule compilation (spec §11.2): clause text → candidate Rule DSL JSON. Deterministic
post-processing does the real work — strip fences, parse, validate, one repair attempt, then give
up honestly. If MODEL_PROVIDER=none or no key is configured, this never pretends to have compiled
anything; the caller (engine/rules/router.py) reports AI_UNAVAILABLE and the officer authors the
rule manually (spec §11.2)."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from engine.llm.client import LlmProvider, NullLlmProvider, get_llm_provider
from engine.rules.schema import load_schema, schema_errors
from engine.rules.semantic import semantic_errors

_PROMPT_PATH = Path(__file__).parent / "prompts" / "compile_rule.md"
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


@dataclass(frozen=True)
class CompileResult:
    status: str  # "COMPILED" | "NOT_EXPRESSIBLE" | "REVIEW_REQUIRED" | "AI_UNAVAILABLE"
    dsl: dict | None
    validation_errors: list[str]
    reason: str | None
    llm_meta: dict | None


def _system_prompt() -> str:
    schema = load_schema()
    claim_types = ", ".join(schema["$defs"]["claimType"]["enum"])
    template = _PROMPT_PATH.read_text(encoding="utf-8")
    return template.replace("{{SCHEMA}}", json.dumps(schema, indent=2)).replace("{{CLAIM_TYPES}}", claim_types)


def _strip_fences(text: str) -> str:
    return _FENCE_RE.sub("", text.strip()).strip()


def _validate(dsl: dict) -> list[str]:
    return schema_errors(dsl) + semantic_errors(dsl)


async def _ask(provider: LlmProvider, system: str, prompt: str) -> tuple[dict | None, str, int]:
    completion = await provider.complete(system=system, prompt=prompt)
    raw = _strip_fences(completion.text)
    try:
        return json.loads(raw), completion.model, completion.latency_ms
    except json.JSONDecodeError:
        return None, completion.model, completion.latency_ms


async def compile_clause(
    *,
    clause_text: str,
    clause_ref: str,
    document_id: str,
    page: int,
    tender_category: str | None,
    provider: LlmProvider | None = None,
) -> CompileResult:
    provider = provider or get_llm_provider()
    if isinstance(provider, NullLlmProvider):
        return CompileResult(status="AI_UNAVAILABLE", dsl=None, validation_errors=[], reason="MODEL_PROVIDER=none or no API key configured", llm_meta=None)

    system = _system_prompt()
    user_prompt = (
        f"Tender category: {tender_category or 'unspecified'}\n"
        f"Clause reference: {clause_ref}\n"
        f"Document ID: {document_id}\n"
        f"Page: {page}\n\n"
        f"Clause text:\n{clause_text}"
    )
    prompt_hash = hashlib.sha256((system + user_prompt).encode("utf-8")).hexdigest()[:16]

    parsed, model, latency_ms = await _ask(provider, system, user_prompt)
    llm_meta: dict[str, Any] = {"provider": "anthropic", "model": model, "latency_ms": latency_ms, "prompt_hash": prompt_hash}

    if parsed is None:
        # One repair attempt: ask again with an explicit reminder. Still malformed → give up honestly.
        repair_prompt = user_prompt + "\n\nYour previous response was not valid JSON. Output ONLY the JSON object, nothing else."
        parsed, model, latency_ms2 = await _ask(provider, system, repair_prompt)
        llm_meta["latency_ms"] += latency_ms2
        if parsed is None:
            return CompileResult(status="REVIEW_REQUIRED", dsl=None, validation_errors=["LLM did not return valid JSON after one repair attempt"], reason=None, llm_meta=llm_meta)

    if parsed.get("expressible") is False:
        return CompileResult(status="NOT_EXPRESSIBLE", dsl=None, validation_errors=[], reason=parsed.get("reason", "Not expressible in the rule DSL."), llm_meta=llm_meta)

    parsed.setdefault("source", {})
    parsed["source"].setdefault("document_id", document_id)
    parsed["source"].setdefault("clause_ref", clause_ref)
    parsed["source"].setdefault("page", page)
    parsed.setdefault("schema_version", "1.0")

    errors = _validate(parsed)
    if errors:
        # One repair attempt sending the validation errors back (spec §11.2).
        repair_prompt = (
            user_prompt
            + "\n\nYour previous JSON failed validation with these errors:\n"
            + "\n".join(f"- {e}" for e in errors)
            + "\n\nOutput a corrected JSON object, still nothing but the JSON."
        )
        parsed2, model2, latency_ms3 = await _ask(provider, system, repair_prompt)
        llm_meta["latency_ms"] += latency_ms3
        if parsed2 is not None and parsed2.get("expressible") is not False:
            parsed2.setdefault("source", {})
            parsed2["source"].setdefault("document_id", document_id)
            parsed2["source"].setdefault("clause_ref", clause_ref)
            parsed2["source"].setdefault("page", page)
            parsed2.setdefault("schema_version", "1.0")
            errors2 = _validate(parsed2)
            if not errors2:
                return CompileResult(status="COMPILED", dsl=parsed2, validation_errors=[], reason=None, llm_meta=llm_meta)
            return CompileResult(status="REVIEW_REQUIRED", dsl=parsed2, validation_errors=errors2, reason=None, llm_meta=llm_meta)
        return CompileResult(status="REVIEW_REQUIRED", dsl=parsed, validation_errors=errors, reason=None, llm_meta=llm_meta)

    return CompileResult(status="COMPILED", dsl=parsed, validation_errors=[], reason=None, llm_meta=llm_meta)
