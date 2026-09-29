"""Engine app factory (spec §4.1). Internal-only: never exposed publicly, reached only by the
API/worker over the internal network with X-Engine-Token."""

from __future__ import annotations

from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException

from engine.common.errors import EngineError, engine_error_handler, http_error_handler, unhandled_error_handler
from engine.documents.router import router as documents_router
from engine.extraction.router import router as extraction_router
from engine.rules.router import router as rules_router
from engine.compliance.router import router as compliance_router
from engine.verification.router import router as verification_router
from engine.reports.router import router as reports_router


def create_app() -> FastAPI:
    app = FastAPI(title="TenderSentry Engine", docs_url=None, redoc_url=None)

    # mypy flags these as incompatible because Starlette's stub expects a handler typed for the
    # base Exception, not our specific subclasses — a known false positive with this pattern.
    app.add_exception_handler(EngineError, engine_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(StarletteHTTPException, http_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.get("/engine/health")
    async def health() -> dict:
        # No X-Engine-Token required (spec §4.1: infra health checks hit this directly).
        return {"status": "OK"}

    engine_router_prefix = "/engine"
    app.include_router(documents_router, prefix=engine_router_prefix)
    app.include_router(extraction_router, prefix=engine_router_prefix)
    app.include_router(rules_router, prefix=engine_router_prefix)
    app.include_router(compliance_router, prefix=engine_router_prefix)
    app.include_router(verification_router, prefix=engine_router_prefix)
    app.include_router(reports_router, prefix=engine_router_prefix)

    return app


app = create_app()
