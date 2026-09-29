"""Field extraction/normalisation (spec §10) and cross-document reconciliation (spec §13.2).
Built in Phase 1 (PAN/GSTIN regex) and Phase 3 (full field registry, tables, LLM-assisted fields)."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from engine.common.auth import require_engine_token
from engine.common.errors import EngineError

router = APIRouter(tags=["extraction"], dependencies=[Depends(require_engine_token)])


@router.post("/reconcile")
async def reconcile(payload: dict) -> dict:
    raise EngineError("NOT_IMPLEMENTED", 501, "Cross-document reconciliation is not built yet — Phase 1/3.")
