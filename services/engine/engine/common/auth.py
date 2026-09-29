"""Internal-only auth (spec §4.1): the engine is never exposed publicly; the API/worker authenticate
with a shared secret header. /engine/health is exempt so infra health checks don't need the token."""

from __future__ import annotations

import hmac

from fastapi import Header

from engine.config import settings
from engine.common.errors import EngineError


async def require_engine_token(x_engine_token: str | None = Header(default=None)) -> None:
    if not x_engine_token or not hmac.compare_digest(x_engine_token, settings.engine_token):
        raise EngineError("FORBIDDEN", 403, "Missing or invalid X-Engine-Token.")
