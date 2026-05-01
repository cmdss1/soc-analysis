import logging

from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from soc_sandbox.config import settings
from soc_sandbox.routes_collector import router as collector_router
from soc_sandbox.routes_sandbox import router as sandbox_router

logger = logging.getLogger("soc_sandbox")

app = FastAPI(title="SOC Kasm Sandbox API", version="0.1.0")


@app.on_event("startup")
async def _log_runtime_flags() -> None:
    if settings.kasm_base_url:
        logger.info("Kasm orchestration enabled (request_kasm → %s)", settings.kasm_base_url.rstrip("/"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(collector_router)
app.include_router(sandbox_router)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "kasm_api_configured": bool(
            settings.kasm_base_url and settings.kasm_api_key and settings.kasm_api_secret
        ),
    }
