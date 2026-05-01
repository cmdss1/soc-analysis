from __future__ import annotations

from typing import Any, Optional

import httpx

from soc_sandbox.config import settings


class KasmError(RuntimeError):
    pass


async def create_session(
    *,
    kasm_url: str,
    environment: dict[str, str],
) -> dict[str, Any]:
    base = settings.kasm_base_url.rstrip("/")
    if not base or not settings.kasm_api_key or not settings.kasm_api_secret:
        raise KasmError("Kasm is not configured (KASM_BASE_URL / keys / image / user)")

    payload: dict[str, Any] = {
        "api_key": settings.kasm_api_key,
        "api_key_secret": settings.kasm_api_secret,
        "user_id": settings.kasm_user_id,
        "image_id": settings.kasm_image_id,
        "kasm_url": kasm_url,
        "environment": environment,
    }

    url = f"{base}/api/public/request_kasm"
    async with httpx.AsyncClient(timeout=60.0, verify=settings.kasm_verify_tls) as client:
        r = await client.post(url, json=payload)
        try:
            body = r.json()
        except Exception as exc:
            raise KasmError(f"Kasm returned non-JSON: {r.status_code} {r.text[:500]}") from exc

        if r.status_code >= 400:
            raise KasmError(
                f"Kasm error {r.status_code}: {body if isinstance(body, dict) else r.text[:500]}"
            )

        if not isinstance(body, dict):
            raise KasmError("Unexpected Kasm response shape")

        return body


async def get_kasm_status(
    *,
    kasm_id: str,
    user_id: Optional[str] = None,
    skip_agent_check: bool = False,
) -> dict[str, Any]:
    """Poll workspace provisioning (Developer API). Viewer URLs often appear only once operational."""
    base = settings.kasm_base_url.rstrip("/")
    uid = user_id or settings.kasm_user_id
    payload: dict[str, Any] = {
        "api_key": settings.kasm_api_key,
        "api_key_secret": settings.kasm_api_secret,
        "user_id": uid,
        "kasm_id": kasm_id,
        "skip_agent_check": skip_agent_check,
    }
    url = f"{base}/api/public/get_kasm_status"
    async with httpx.AsyncClient(timeout=45.0, verify=settings.kasm_verify_tls) as client:
        r = await client.post(url, json=payload)
        try:
            body = r.json()
        except Exception as exc:
            raise KasmError(f"get_kasm_status non-JSON: {r.status_code} {r.text[:500]}") from exc

        if r.status_code >= 400:
            raise KasmError(
                f"get_kasm_status error {r.status_code}: {body if isinstance(body, dict) else r.text[:500]}"
            )

        if not isinstance(body, dict):
            raise KasmError("get_kasm_status unexpected shape")

        return body


async def get_kasm_screenshot(
    *,
    kasm_id: str,
    user_id: Optional[str] = None,
    width: int = 1280,
    height: int = 800,
) -> Optional[bytes]:
    """Returns PNG bytes for a screenshot of the current kasm desktop, or None if unavailable.

    Kasm Developer API exposes /api/public/get_kasm_screenshot which returns
    `{"kasm_frame": "<base64-png>"}` (newer builds) or `{"images": [{"image": "<b64>"}]}`.
    We try several response shapes to stay version-tolerant.
    """
    import base64

    base = settings.kasm_base_url.rstrip("/")
    uid = user_id or settings.kasm_user_id
    payload: dict[str, Any] = {
        "api_key": settings.kasm_api_key,
        "api_key_secret": settings.kasm_api_secret,
        "user_id": uid,
        "kasm_id": kasm_id,
        "width": width,
        "height": height,
    }
    url = f"{base}/api/public/get_kasm_screenshot"
    async with httpx.AsyncClient(timeout=30.0, verify=settings.kasm_verify_tls) as client:
        r = await client.post(url, json=payload)
        if r.headers.get("content-type", "").startswith("image/"):
            return r.content
        try:
            body = r.json()
        except Exception:
            return None
        if r.status_code >= 400 or not isinstance(body, dict):
            return None
        for key in ("kasm_frame", "image", "screenshot", "kasm_screenshot"):
            v = body.get(key)
            if isinstance(v, str) and v:
                try:
                    return base64.b64decode(v)
                except Exception:
                    continue
        images = body.get("images")
        if isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                v = first.get("image") or first.get("data")
                if isinstance(v, str) and v:
                    try:
                        return base64.b64decode(v)
                    except Exception:
                        return None
        return None


async def destroy_session(*, kasm_id: str, user_id: Optional[str] = None) -> dict[str, Any]:
    """Best-effort destroy; Kasm editions vary — caller should tolerate failures."""
    base = settings.kasm_base_url.rstrip("/")
    uid = user_id or settings.kasm_user_id
    payload = {
        "api_key": settings.kasm_api_key,
        "api_key_secret": settings.kasm_api_secret,
        "user_id": uid,
        "kasm_id": kasm_id,
    }
    url = f"{base}/api/public/destroy_kasm"
    async with httpx.AsyncClient(timeout=30.0, verify=settings.kasm_verify_tls) as client:
        r = await client.post(url, json=payload)
        try:
            return r.json()
        except Exception:
            return {"status_code": r.status_code, "text": r.text[:500]}
