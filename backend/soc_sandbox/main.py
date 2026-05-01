from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from soc_sandbox.config import settings
from soc_sandbox.routes_collector import router as collector_router
from soc_sandbox.routes_sandbox import router as sandbox_router

app = FastAPI(title="SOC Kasm Sandbox API", version="0.1.0")

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
async def health() -> dict[str, str]:
    return {"status": "ok"}
