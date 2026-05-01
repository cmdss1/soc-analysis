"""
mitmproxy addon: forwards normalized events to the SOC collector HTTP ingest API.
Loaded via: mitmdump --scripts /opt/soc/mitm_addon.py
"""

from __future__ import annotations

import base64
import json
import os
import threading
import urllib.error
import urllib.request
import uuid
from typing import Any

from mitmproxy import ctx, http

MAX_BODY_PREVIEW = int(os.environ.get("SOC_MAX_BODY_BYTES", "65536"))
COLLECTOR_URL = (os.environ.get("SOC_COLLECTOR_URL") or "").strip().rstrip("/")
INGEST_TOKEN = (os.environ.get("SOC_INGEST_TOKEN") or "").strip()
SESSION_ID = (os.environ.get("SOC_SESSION_ID") or "").strip()


def _utc_ts() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _truncate_text(raw: bytes) -> tuple[int, str]:
    snippet = raw[:MAX_BODY_PREVIEW]
    try:
        return len(raw), snippet.decode("utf-8", errors="replace")
    except Exception:
        return len(raw), base64.b64encode(snippet).decode("ascii")


def _cert_summary(flow: http.HTTPFlow) -> dict[str, Any] | None:
    conn = flow.server_conn
    if not conn:
        return None
    certs = getattr(conn, "certificate_list", None) or []
    if not certs:
        return None
    first = certs[0]
    subject = getattr(first, "subject", None)
    issuer = getattr(first, "issuer", None)
    serial = getattr(first, "serial", None)
    return {
        "subject": str(subject) if subject else None,
        "issuer": str(issuer) if issuer else None,
        "serial": str(serial) if serial is not None else None,
    }


def _tls_meta(flow: http.HTTPFlow) -> dict[str, Any]:
    conn = flow.server_conn
    if not conn:
        return {}
    alpn = getattr(conn, "alpn", None)
    if isinstance(alpn, (bytes, bytearray)):
        try:
            alpn = alpn.decode("ascii", errors="replace")
        except Exception:
            alpn = str(alpn)
    return {
        "tls_established": bool(getattr(conn, "tls_established", False)),
        "tls_version": getattr(conn, "tls_version", None),
        "alpn": alpn,
        "sni": getattr(conn, "sni", None),
    }


def _server_endpoint(flow: http.HTTPFlow) -> dict[str, Any]:
    """Emit resolved IP separately from requested host so the SOC UI can show both."""
    conn = flow.server_conn
    out: dict[str, Any] = {"server_ip": None, "server_port": None, "server_host": None}
    if not conn:
        return out
    addr = getattr(conn, "address", None)
    if isinstance(addr, (list, tuple)) and len(addr) >= 2:
        out["server_host"] = addr[0]
        out["server_port"] = addr[1]
    peer = getattr(conn, "peername", None)
    if isinstance(peer, (list, tuple)) and len(peer) >= 2:
        out["server_ip"] = peer[0]
        if not out["server_port"]:
            out["server_port"] = peer[1]
    return out


def _post_event(event: dict[str, Any]) -> None:
    if not COLLECTOR_URL or not INGEST_TOKEN:
        return
    if SESSION_ID:
        event.setdefault("session_id", SESSION_ID)
    event.setdefault("ts", _utc_ts())
    payload = json.dumps(event, default=str).encode("utf-8")
    req = urllib.request.Request(
        COLLECTOR_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {INGEST_TOKEN}",
        },
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except urllib.error.HTTPError as e:
        ctx.log.warn(f"SOC collector HTTPError: {e.code} {e.reason} url={COLLECTOR_URL!r}")
    except urllib.error.URLError as e:
        ctx.log.warn(f"SOC collector URLError: {e.reason} url={COLLECTOR_URL!r}")
    except Exception as e:
        ctx.log.warn(f"SOC collector error: {e} url={COLLECTOR_URL!r}")


def emit(event: dict[str, Any]) -> None:
    threading.Thread(target=_post_event, args=(event,), daemon=True).start()


class SocCollectorAddon:
    def running(self) -> None:
        ctx.log.info(
            f"SOC addon running collector={COLLECTOR_URL!r} session={SESSION_ID!r}"
        )

    def http_connect(self, flow: http.HTTPFlow) -> None:
        endpoint = _server_endpoint(flow)
        emit(
            {
                "type": "http_connect",
                "host": flow.request.host,
                "port": flow.request.port,
                "client_ip": flow.client_conn.peername[0]
                if flow.client_conn.peername
                else None,
                **endpoint,
            }
        )

    def request(self, flow: http.HTTPFlow) -> None:
        rid = str(uuid.uuid4())
        flow.metadata["soc_request_id"] = rid
        raw = flow.request.get_content() or b""
        blen, preview = _truncate_text(raw)
        hdrs = {k: v for k, v in flow.request.headers.items()}
        emit(
            {
                "type": "http_request",
                "request_id": rid,
                "method": flow.request.method,
                "scheme": flow.request.scheme,
                "host": flow.request.host,
                "port": flow.request.port,
                "path": flow.request.path,
                "http_version": flow.request.http_version,
                "headers": hdrs,
                "body_len": blen,
                "body_preview": preview,
            }
        )

    def response(self, flow: http.HTTPFlow) -> None:
        rid = flow.metadata.get("soc_request_id")
        if not rid:
            return
        raw = flow.response.get_content() or b""
        blen, preview = _truncate_text(raw)
        hdrs = {k: v for k, v in flow.response.headers.items()}
        endpoint = _server_endpoint(flow)
        event: dict[str, Any] = {
            "type": "http_response",
            "request_id": rid,
            "status_code": flow.response.status_code,
            "reason": flow.response.reason,
            "headers": hdrs,
            "body_len": blen,
            "body_preview": preview,
            "content_type": flow.response.headers.get("content-type"),
            "tls": _tls_meta(flow),
            "server_cert": _cert_summary(flow),
            **endpoint,
        }
        emit(event)


addons = [SocCollectorAddon()]
