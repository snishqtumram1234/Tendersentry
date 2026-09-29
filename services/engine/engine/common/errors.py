"""Shared error shape (spec §4.5), mirroring apps/api/src/lib/errors.ts so the API can pass an
engine error straight through to the client without translation."""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import uuid


class EngineError(Exception):
    def __init__(self, code: str, status: int, message: str, *, retryable: bool = False, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.retryable = retryable
        self.details = details or {}


def _request_id(request: Request) -> str:
    return request.headers.get("x-request-id") or str(uuid.uuid4())


def error_body(code: str, message: str, request: Request, *, retryable: bool = False, details: dict | None = None) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
            "requestId": _request_id(request),
        }
    }


async def engine_error_handler(request: Request, exc: EngineError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content=error_body(exc.code, exc.message, request, retryable=exc.retryable, details=exc.details),
    )


async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    code = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL_ERROR" if exc.status_code >= 500 else "VALIDATION_ERROR"
    return JSONResponse(status_code=exc.status_code, content=error_body(code, str(exc.detail), request))


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content=error_body("INTERNAL_ERROR", "Something went wrong.", request, retryable=True))
