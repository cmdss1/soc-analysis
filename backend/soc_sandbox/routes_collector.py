from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request

from soc_sandbox.sessions import registry

router = APIRouter(prefix="/api/v1/collector", tags=["collector"])


@router.post("/ingest")
async def ingest_events(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict[str, Any]:
    parts = (authorization or "").split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    token = parts[1].strip()
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from exc

    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON object expected")

    sid = body.get("session_id")
    if not sid or not isinstance(sid, str):
        raise HTTPException(status_code=400, detail="session_id required")

    rec = registry.resolve_token(token)
    if not rec or rec.id != sid:
        raise HTTPException(status_code=403, detail="Invalid session or token")

    await registry.publish(rec.id, body)
    return {"ok": True}


__all__ = ["router"]
