from __future__ import annotations

import asyncio
import json
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from soc_sandbox.config import settings
from soc_sandbox.kasm import KasmError, create_session, destroy_session, get_kasm_status
from soc_sandbox.sessions import registry
from soc_sandbox.url_validate import UrlRejected, validate_target_url

router = APIRouter(prefix="/api/v1/sandbox", tags=["sandbox"])


class CreateSessionBody(BaseModel):
    url: str = Field(..., min_length=4, max_length=8192)


def _extract_kasm_viewer_raw(resp: dict[str, Any]) -> Optional[str]:
    """Kasm editions nest viewer paths under top-level or inside ``kasm``."""
    priority_keys = (
        "kasm_url",
        "viewer_url",
        "casting_url",
        "cast_url",
        "connection_url",
    )
    for key in priority_keys:
        v = resp.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    nested = resp.get("kasm")
    if isinstance(nested, dict):
        for key in priority_keys:
            x = nested.get(key)
            if isinstance(x, str) and x.strip():
                return x.strip()
    for blob in (resp, nested if isinstance(nested, dict) else None):
        if not isinstance(blob, dict):
            continue
        for val in blob.values():
            if isinstance(val, str) and "/#/connect/kasm/" in val:
                return val.strip()
    return None


def _extract_kasm_id(resp: dict[str, Any]) -> Optional[str]:
    kid = resp.get("kasm_id")
    if isinstance(kid, str) and kid.strip():
        return kid.strip()
    nested = resp.get("kasm")
    if isinstance(nested, dict):
        for key in ("kasm_id", "id", "session_id"):
            x = nested.get(key)
            if isinstance(x, str) and x.strip():
                return x.strip()
    return None


def _absolute_kasm_viewer(viewer: Optional[str]) -> Optional[str]:
    if not viewer:
        return None
    if viewer.startswith(("http://", "https://")):
        return viewer
    base = urlparse(settings.kasm_base_url)
    if not base.scheme or not base.netloc:
        return viewer
    origin = f"{base.scheme}://{base.netloc}"
    if viewer.startswith("/"):
        return origin + viewer
    if viewer.startswith("#"):
        return f"{origin}/{viewer}"
    return viewer


async def _poll_until_kasm_viewer(kasm_id: str, *, attempts: int = 45, delay_s: float = 2.0) -> Optional[str]:
    """Kasm omits kasm_url until operational_status is running — poll get_kasm_status."""
    for attempt in range(attempts):
        if attempt > 0:
            await asyncio.sleep(delay_s)
        try:
            st = await get_kasm_status(kasm_id=kasm_id)
        except KasmError:
            continue
        path = _extract_kasm_viewer_raw(st)
        if path:
            return path
        op = st.get("operational_status")
        nested = st.get("kasm")
        if isinstance(nested, dict):
            op = op or nested.get("operational_status")
        if op in ("stopped", "failed", "error", "destroyed"):
            break
    return None


@router.post("/sessions")
async def start_session(body: CreateSessionBody) -> dict[str, Any]:
    try:
        url = validate_target_url(
            body.url,
            block_private_ips=settings.block_private_target_ips,
        )
    except UrlRejected as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    rec = registry.create(url)
    env = {
        "SOC_COLLECTOR_URL": settings.ingest_url(),
        "SOC_INGEST_TOKEN": rec.ingest_token,
        "SOC_SESSION_ID": rec.id,
    }

    try:
        resp = await create_session(kasm_url=url, environment=env)
        kid = _extract_kasm_id(resp)
        if not kid:
            registry.discard_record(rec)
            err = (
                resp.get("error_message")
                or resp.get("error")
                or resp.get("message")
                or "no kasm_id in response"
            )
            raise HTTPException(
                status_code=503,
                detail=f"Kasm request_kasm failed: {err} | response_keys={list(resp.keys())}",
            )
        viewer = _extract_kasm_viewer_raw(resp)
        if not viewer and kid:
            viewer = await _poll_until_kasm_viewer(kid)
        rec.kasm_id = kid
        rec.kasm_viewer_url = _absolute_kasm_viewer(viewer)
    except KasmError as e:
        registry.discard_record(rec)
        raise HTTPException(status_code=503, detail=str(e)) from e

    return {
        "session_id": rec.id,
        "target_url": rec.target_url,
        "kasm_id": rec.kasm_id,
        "kasm_viewer_url": rec.kasm_viewer_url,
        "ingest_configured": bool(settings.public_api_base),
    }


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    rec = registry.get(session_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown session")
    needs_poll = bool(rec.kasm_id and not rec.kasm_viewer_url)
    if needs_poll:
        raw = await _poll_until_kasm_viewer(rec.kasm_id, attempts=45, delay_s=2.0)
        if raw:
            rec.kasm_viewer_url = _absolute_kasm_viewer(raw)
    return {
        "session_id": rec.id,
        "target_url": rec.target_url,
        "kasm_id": rec.kasm_id,
        "kasm_viewer_url": rec.kasm_viewer_url,
    }


@router.get("/sessions/{session_id}/events")
async def session_events(session_id: str) -> StreamingResponse:
    try:
        rec, q = registry.subscribe(session_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="Unknown session") from e

    async def gen():
        try:
            for ev in list(rec.recent_events):
                yield f"data: {json.dumps(ev)}\n\n"
            while True:
                ev = await q.get()
                yield f"data: {json.dumps(ev)}\n\n"
        except asyncio.CancelledError:
            raise
        finally:
            registry.unsubscribe(session_id, q)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/destroy")
async def stop_session(session_id: str) -> dict[str, Any]:
    rec = registry.get(session_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown session")
    if not rec.kasm_id:
        return {"ok": True, "detail": "no kasm id"}
    try:
        out = await destroy_session(kasm_id=rec.kasm_id)
        return {"ok": True, "kasm": out}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


__all__ = ["router"]
