"""Verification adapters and router (spec §14): structural, cross-document, PDF signature, QR,
officer-assisted queue, GST provider, simulated (dev-only). Built in Phase 5.

`adapter` is validated against the real adapter code list now, even though each adapter's logic is
still a stub — spec §2 rule 1/2: no adapter may claim a capability it doesn't have, so an unknown
adapter name is a 404, not a silently-accepted no-op."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from engine.common.auth import require_engine_token
from engine.common.errors import EngineError

router = APIRouter(prefix="/verify", tags=["verification"], dependencies=[Depends(require_engine_token)])

# Spec §7.7 SourceCode enum — kept in sync by hand until packages/types is shared with Python too.
KNOWN_ADAPTERS = {
    "PAN",
    "GST",
    "UDYAM",
    "MCA",
    "DIGILOCKER",
    "EPFO",
    "ESIC",
    "BIS",
    "PDF_SIGNATURE",
    "QR",
    "STRUCTURAL",
    "CROSS_DOCUMENT",
    "GST_PROVIDER_API",
    "SIMULATED",
}


def _check_adapter(adapter: str) -> None:
    if adapter not in KNOWN_ADAPTERS:
        raise EngineError("NOT_FOUND", 404, f"Unknown verification adapter '{adapter}'.")


@router.post("/{adapter}")
async def verify(adapter: str, payload: dict) -> dict:
    _check_adapter(adapter)
    raise EngineError("NOT_IMPLEMENTED", 501, f"The '{adapter}' verification adapter is not built yet — Phase 5.")


@router.post("/{adapter}/health")
async def verify_health(adapter: str) -> dict:
    _check_adapter(adapter)
    raise EngineError("NOT_IMPLEMENTED", 501, f"Health checks for the '{adapter}' adapter are not built yet — Phase 5.")
