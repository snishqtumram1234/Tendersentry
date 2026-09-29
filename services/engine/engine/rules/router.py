"""Clause segmentation, LLM rule compiler, DSL schema validation, plain-English rendering
(spec §11, §12). Built in Phase 2."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from engine.common.auth import require_engine_token
from engine.common.errors import EngineError
from engine.common.storage import get_object_bytes
from engine.documents.pipeline import extract_native_page_texts
from engine.rules.ambiguity import detect_ambiguities
from engine.rules.compiler import compile_clause
from engine.rules.render_english import render_plain_english
from engine.rules.schema import schema_errors
from engine.rules.segmentation import segment_pages
from engine.rules.semantic import semantic_errors

router = APIRouter(tags=["rules"], dependencies=[Depends(require_engine_token)])


class SegmentRequest(BaseModel):
    storage_bucket: str
    storage_key: str


@router.post("/tenders/segment")
async def segment_tender(payload: SegmentRequest) -> dict:
    try:
        data = get_object_bytes(payload.storage_bucket, payload.storage_key)
    except Exception as exc:
        raise EngineError("SOURCE_UNAVAILABLE", 502, f"Could not fetch the tender document from storage: {exc}", retryable=True) from exc

    pages = extract_native_page_texts(data)
    clauses = segment_pages(pages)
    return {
        "clauses": [
            {
                "clauseRef": c.clause_ref,
                "heading": c.heading,
                "text": c.text,
                "pageStart": c.page_start,
                "pageEnd": c.page_end,
                "isRequirementCandidate": c.is_requirement_candidate,
            }
            for c in clauses
        ]
    }


class CompileRequest(BaseModel):
    clause_text: str
    clause_ref: str
    document_id: str
    page: int
    tender_category: str | None = None


@router.post("/rules/compile")
async def compile_rule(payload: CompileRequest) -> dict:
    result = await compile_clause(
        clause_text=payload.clause_text,
        clause_ref=payload.clause_ref,
        document_id=payload.document_id,
        page=payload.page,
        tender_category=payload.tender_category,
    )
    # Deterministic checks run regardless of LLM availability/success (spec §11.3) — merge with
    # whatever the LLM itself flagged in dsl.ambiguities, deduped by code.
    deterministic = [{"code": a.code, "question": a.question, "options": list(a.options)} for a in detect_ambiguities(payload.clause_text)]
    llm_ambiguities = (result.dsl or {}).get("ambiguities", []) if result.dsl else []
    seen_codes = {a["code"] for a in llm_ambiguities}
    merged_ambiguities = llm_ambiguities + [a for a in deterministic if a["code"] not in seen_codes]

    return {
        "status": result.status,
        "dsl": result.dsl,
        "validationErrors": result.validation_errors,
        "reason": result.reason,
        "llmMeta": result.llm_meta,
        "ambiguities": merged_ambiguities,
    }


class ValidateRequest(BaseModel):
    dsl: dict


@router.post("/rules/validate")
async def validate_rule(payload: ValidateRequest) -> dict:
    errors = schema_errors(payload.dsl)
    sem_errors = semantic_errors(payload.dsl) if not errors else []
    return {"valid": not errors and not sem_errors, "schemaErrors": errors, "semanticErrors": sem_errors}


class RenderRequest(BaseModel):
    dsl: dict


@router.post("/rules/render-english")
async def render_english(payload: RenderRequest) -> dict:
    return {"plainEnglish": render_plain_english(payload.dsl)}
