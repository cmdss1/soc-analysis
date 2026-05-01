from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from soc_sandbox.config import settings
from soc_sandbox.kasm import (
    KasmError,
    create_session,
    destroy_session,
    get_kasm_screenshot,
    get_kasm_status,
)
from soc_sandbox.sessions import SandboxSession, registry
from soc_sandbox.url_validate import UrlRejected, validate_target_url

logger = logging.getLogger("soc_sandbox.routes")
router = APIRouter(prefix="/api/v1/sandbox", tags=["sandbox"])

ANALYSIS_DURATION_S = 30.0
SCREENSHOT_RETRIES = 8


class CreateSessionBody(BaseModel):
    url: str = Field(..., min_length=4, max_length=8192)


def _extract_kasm_viewer_raw(resp: dict[str, Any]) -> Optional[str]:
    priority_keys = ("kasm_url", "viewer_url", "casting_url", "cast_url", "connection_url")
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


async def _wait_for_running(kasm_id: str, *, attempts: int = 30, delay_s: float = 2.0) -> bool:
    for i in range(attempts):
        if i > 0:
            await asyncio.sleep(delay_s)
        try:
            st = await get_kasm_status(kasm_id=kasm_id)
        except KasmError:
            continue
        op = st.get("operational_status")
        nested = st.get("kasm")
        if isinstance(nested, dict):
            op = op or nested.get("operational_status")
        if op == "running":
            return True
        if op in ("stopped", "failed", "error", "destroyed"):
            return False
    return False


def _summary(rec: SandboxSession) -> dict[str, Any]:
    flows: dict[str, dict[str, Any]] = {}
    hosts: dict[str, dict[str, Any]] = {}
    for ev in rec.recent_events:
        if ev.get("type") not in ("http_request", "http_response"):
            continue
        rid = ev.get("request_id")
        if not rid:
            continue
        cur = flows.setdefault(rid, {})
        for k in ("method", "host", "path", "scheme", "status_code", "server_ip", "content_type"):
            v = ev.get(k)
            if v is not None and cur.get(k) is None:
                cur[k] = v
        if ev.get("type") == "http_response" and ev.get("body_len") is not None:
            cur["resp_len"] = ev.get("body_len")
    for f in flows.values():
        h = f.get("host")
        if not h:
            continue
        hr = hosts.setdefault(h, {"host": h, "ips": set(), "count": 0, "errors": 0})
        hr["count"] += 1
        if f.get("server_ip"):
            hr["ips"].add(f["server_ip"])
        if (f.get("status_code") or 0) >= 400:
            hr["errors"] += 1
    return {
        "flow_count": len(flows),
        "host_count": len(hosts),
        "hosts": [
            {**h, "ips": sorted(h["ips"])}
            for h in sorted(hosts.values(), key=lambda x: -x["count"])[:50]
        ],
    }


def _public_record(rec: SandboxSession) -> dict[str, Any]:
    return {
        "session_id": rec.id,
        "target_url": rec.target_url,
        "kasm_id": rec.kasm_id,
        "kasm_viewer_url": rec.kasm_viewer_url,
        "status": rec.status,
        "error": rec.error,
        "created_at": rec.created_at,
        "completed_at": rec.completed_at,
        "elapsed_s": (rec.completed_at or time.time()) - rec.created_at,
        "has_screenshot": rec.screenshot_png is not None,
        "summary": _summary(rec),
    }


async def _analyze(rec: SandboxSession) -> None:
    """Background worker: wait for kasm running -> sleep for traffic capture -> snapshot -> destroy."""
    rec.status = "analyzing"
    try:
        if not rec.kasm_id:
            rec.status = "failed"
            rec.error = "No kasm_id"
            return

        running = await _wait_for_running(rec.kasm_id)
        if not running:
            rec.status = "failed"
            rec.error = "Kasm workspace never reached running state"

        await asyncio.sleep(ANALYSIS_DURATION_S)

        for attempt in range(SCREENSHOT_RETRIES):
            try:
                png = await get_kasm_screenshot(kasm_id=rec.kasm_id)
            except Exception as exc:
                logger.warning("screenshot attempt %s failed: %s", attempt, exc)
                png = None
            if png:
                rec.screenshot_png = png
                break
            await asyncio.sleep(2.0)

        try:
            await destroy_session(kasm_id=rec.kasm_id)
        except Exception as exc:
            logger.warning("destroy_kasm failed: %s", exc)

        if rec.status != "failed":
            rec.status = "completed"
        rec.completed_at = time.time()
    except Exception as exc:  # noqa: BLE001
        logger.exception("analysis worker error")
        rec.status = "failed"
        rec.error = str(exc)
        rec.completed_at = time.time()


@router.post("/sessions")
async def start_session(body: CreateSessionBody) -> dict[str, Any]:
    try:
        url = validate_target_url(
            body.url, block_private_ips=settings.block_private_target_ips
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
    except KasmError as e:
        registry.discard_record(rec)
        raise HTTPException(status_code=503, detail=str(e)) from e

    kid = _extract_kasm_id(resp)
    if not kid:
        registry.discard_record(rec)
        err = (
            resp.get("error_message")
            or resp.get("error")
            or resp.get("message")
            or "no kasm_id"
        )
        raise HTTPException(
            status_code=503, detail=f"Kasm request_kasm failed: {err}"
        )

    rec.kasm_id = kid
    rec.kasm_viewer_url = _absolute_kasm_viewer(_extract_kasm_viewer_raw(resp))
    rec.status = "analyzing"

    asyncio.create_task(_analyze(rec))

    return _public_record(rec)


@router.get("/sessions/{session_id}")
async def get_session(session_id: str) -> dict[str, Any]:
    rec = registry.get(session_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown session")
    return _public_record(rec)


@router.get("/sessions/{session_id}/screenshot")
async def session_screenshot(session_id: str) -> Response:
    rec = registry.get(session_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Unknown session")
    if not rec.screenshot_png:
        raise HTTPException(status_code=404, detail="No screenshot yet")
    return Response(content=rec.screenshot_png, media_type="image/png")


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
        rec.status = "completed"
        rec.completed_at = time.time()
        return {"ok": True, "kasm": out}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


__all__ = ["router"]
