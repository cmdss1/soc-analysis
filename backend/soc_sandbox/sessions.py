from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import uuid4


@dataclass
class SandboxSession:
    id: str
    ingest_token: str
    target_url: str
    kasm_id: Optional[str] = None
    kasm_viewer_url: Optional[str] = None
    status: str = "pending"  # pending | analyzing | completed | failed
    error: Optional[str] = None
    created_at: float = field(default_factory=lambda: __import__("time").time())
    completed_at: Optional[float] = None
    screenshot_png: Optional[bytes] = None
    recent_events: deque[dict[str, Any]] = field(
        default_factory=lambda: deque(maxlen=2000)
    )
    subscriber_queues: list[asyncio.Queue[dict[str, Any]]] = field(
        default_factory=list
    )


class SessionRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, SandboxSession] = {}
        self._by_token: dict[str, str] = {}

    def create(self, target_url: str) -> SandboxSession:
        sid = str(uuid4())
        token = str(uuid4())
        rec = SandboxSession(id=sid, ingest_token=token, target_url=target_url)
        self._sessions[sid] = rec
        self._by_token[token] = sid
        return rec

    def get(self, session_id: str) -> Optional[SandboxSession]:
        return self._sessions.get(session_id)

    def resolve_token(self, token: str) -> Optional[SandboxSession]:
        sid = self._by_token.get(token)
        return self._sessions.get(sid) if sid else None

    async def publish(self, session_id: str, event: dict[str, Any]) -> None:
        rec = self._sessions.get(session_id)
        if not rec:
            return
        rec.recent_events.append(event)
        dead: list[asyncio.Queue[dict[str, Any]]] = []
        for q in list(rec.subscriber_queues):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            if q in rec.subscriber_queues:
                rec.subscriber_queues.remove(q)

    def subscribe(self, session_id: str) -> tuple[SandboxSession, asyncio.Queue[dict[str, Any]]]:
        rec = self._sessions.get(session_id)
        if not rec:
            raise KeyError(session_id)
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=256)
        rec.subscriber_queues.append(q)
        return rec, q

    def unsubscribe(self, session_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        rec = self._sessions.get(session_id)
        if rec and q in rec.subscriber_queues:
            rec.subscriber_queues.remove(q)

    def discard_record(self, rec: SandboxSession) -> None:
        self._sessions.pop(rec.id, None)
        self._by_token.pop(rec.ingest_token, None)


registry = SessionRegistry()
