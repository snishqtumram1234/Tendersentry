"""PDF/CSV/JSON report generation (spec §18.1, reportlab). Built in Phase 7."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from engine.common.auth import require_engine_token
from engine.common.errors import EngineError

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_engine_token)])


@router.post("/render")
async def render_report(payload: dict) -> dict:
    raise EngineError("NOT_IMPLEMENTED", 501, "Report rendering is not built yet — Phase 7.")
