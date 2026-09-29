"""Tests for engine.rules.compiler (spec §11.2). No real network calls — a fake LlmProvider is
injected for the "LLM succeeds" paths, and the no-key path is tested against the real
get_llm_provider() default (NullLlmProvider), matching this environment's actual .env
(MODEL_PROVIDER_KEY is unset)."""

import json


from engine.llm.client import LlmCompletion, LlmProvider
from engine.rules.compiler import compile_clause


class FakeProvider(LlmProvider):
    def __init__(self, responses: list[str]):
        self._responses = list(responses)

    async def complete(self, *, system: str, prompt: str) -> LlmCompletion:
        text = self._responses.pop(0)
        return LlmCompletion(text=text, provider="fake", model="fake-model", latency_ms=1)


VALID_DSL_JSON = json.dumps(
    {
        "schema_version": "1.0",
        "rule_code": "R-01",
        "name": "Valid PAN",
        "requirement_category": "IDENTITY",
        "mandatory": True,
        "envelope": "TECHNICAL",
        "on_missing_evidence": "REVIEW_REQUIRED",
        "expression": {"node": "FIELD_MATCH", "field": "PAN"},
        "plain_english": "PAN must be consistent across submitted documents.",
        "ambiguities": [],
    }
)


async def test_no_provider_configured_is_honest_about_it():
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None)
    assert result.status == "AI_UNAVAILABLE"
    assert result.dsl is None


async def test_valid_first_response_compiles_successfully():
    provider = FakeProvider([VALID_DSL_JSON])
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None, provider=provider)
    assert result.status == "COMPILED"
    assert result.dsl["rule_code"] == "R-01"
    assert result.dsl["source"]["clause_ref"] == "7.1"
    assert result.llm_meta["provider"] == "anthropic"  # llm_meta always says "anthropic" per spec's provider label


async def test_not_expressible_is_reported_honestly():
    provider = FakeProvider([json.dumps({"expressible": False, "reason": "Too vague to encode."})])
    result = await compile_clause(clause_text="Bidders should generally be reputable.", clause_ref="1.1", document_id="doc-1", page=1, tender_category=None, provider=provider)
    assert result.status == "NOT_EXPRESSIBLE"
    assert result.reason == "Too vague to encode."


async def test_malformed_json_gets_one_repair_attempt_then_succeeds():
    provider = FakeProvider(["not json at all", VALID_DSL_JSON])
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None, provider=provider)
    assert result.status == "COMPILED"


async def test_malformed_json_twice_gives_up_honestly():
    provider = FakeProvider(["not json", "still not json"])
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None, provider=provider)
    assert result.status == "REVIEW_REQUIRED"
    assert result.dsl is None
    assert result.validation_errors


async def test_schema_invalid_response_gets_repaired():
    invalid = json.dumps({"schema_version": "1.0", "expression": {"node": "MADE_UP"}})
    result_provider = FakeProvider([invalid, VALID_DSL_JSON])
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None, provider=result_provider)
    assert result.status == "COMPILED"


async def test_schema_invalid_after_repair_is_review_required_not_fabricated():
    invalid = json.dumps({"schema_version": "1.0", "expression": {"node": "MADE_UP"}})
    provider = FakeProvider([invalid, invalid])
    result = await compile_clause(clause_text="The bidder shall hold a valid PAN.", clause_ref="7.1", document_id="doc-1", page=1, tender_category=None, provider=provider)
    assert result.status == "REVIEW_REQUIRED"
    assert result.validation_errors
