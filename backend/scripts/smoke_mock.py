"""Run from backend/: MOCK_KASM=true python scripts/smoke_mock.py"""

import asyncio
import os

os.environ.setdefault("MOCK_KASM", "true")
os.environ.setdefault("MOCK_KASM_VIEWER_URL", "about:blank")

from httpx import ASGITransport, AsyncClient

from soc_sandbox.main import app
from soc_sandbox.sessions import registry


async def main() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.post(
            "/api/v1/sandbox/sessions", json={"url": "https://example.com"}
        )
        print("create", r.status_code, r.json())
        body = r.json()
        sid = body["session_id"]
        rec = registry.get(sid)
        assert rec is not None
        sample = {
            "session_id": sid,
            "type": "http_request",
            "request_id": "rid-1",
            "method": "GET",
            "host": "example.com",
            "path": "/",
            "scheme": "https",
            "body_len": 0,
            "body_preview": "",
        }
        ir = await client.post(
            "/api/v1/collector/ingest",
            json=sample,
            headers={"Authorization": f"Bearer {rec.ingest_token}"},
        )
        print("ingest", ir.status_code, ir.json())


if __name__ == "__main__":
    asyncio.run(main())
