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

    url = f"{base}/api/public/create_session"
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
