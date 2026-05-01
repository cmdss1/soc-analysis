# SOC Kasm Sandbox

SOC-facing launcher plus realtime MITM telemetry derived from mitmproxy running inside a custom [**kasmweb/chrome**](https://hub.docker.com/r/kasmweb/chrome) workspace.

## Repo layout

| Path | Purpose |
| --- | --- |
| [`docker/kasm-chrome-mitm`](docker/kasm-chrome-mitm) | Custom workspace Dockerfile + Chrome enterprise proxy policy + mitmproxy addon |
| [`.github/workflows/publish-kasm-chrome-mitm.yml`](.github/workflows/publish-kasm-chrome-mitm.yml) | CI: build → **`ghcr.io/<owner>/kasm-chrome-mitm:1.0`** (GitHub Actions) |
| [`backend`](backend) | FastAPI orchestrator (`create_session`) + collector ingest + SSE fan-out |
| [`frontend`](frontend) | Next.js UI |
| [`docs/KASM_ADMIN.md`](docs/KASM_ADMIN.md) | Register image / keys / networking |

## Quick start (mock Kasm)

```bash
docker compose up --build
```

This enables `MOCK_KASM=true` so the UI + SSE stack works without live Kasm. Visit http://localhost:3000.

Backend smoke test (from `backend/`):

```powershell
$env:PYTHONPATH='.'
$env:MOCK_KASM='true'
python scripts/smoke_mock.py
```

## Local development without Docker Compose

**Backend**

```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate         # Windows
pip install -r requirements.txt
copy .env.example .env           # edit values
python -m uvicorn soc_sandbox.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend**

```bash
cd frontend
copy .env.example .env.local     # optional override
npm install
npm run dev
```

On **Windows**, if `npm` is not recognized, install [Node.js LTS](https://nodejs.org/) (includes npm), **close and reopen** your terminal, then try again. Or run [`frontend/run-dev.ps1`](frontend/run-dev.ps1), which prepends `Program Files\nodejs` for that session. Nothing will answer **http://localhost:3000** until `npm run dev` is running.

## Environment essentials

| Variable | Meaning |
| --- | --- |
| `PUBLIC_API_BASE` | Absolute URL of this API reachable **from inside Kasm workspaces** for `/api/v1/collector/ingest` |
| `KASM_*` | Developer API credentials + `image_id` + `user_id` |
| `MOCK_KASM` | `true` skips Kasm for UI wiring tests |

## MITM event schema (collector ingest)

JSON POST bodies include at minimum:

- `session_id`, `type`, `ts`
- `http_request` / `http_response` pairs keyed by `request_id`
- `http_connect` rows for TLS tunnels

Bodies are truncated (`SOC_MAX_BODY_BYTES`, default 65536 inside the workspace).

## Production notes

- Run API behind TLS termination and restrict collector ingest by network ACL.
- Pair analysts with dedicated Kasm users for audit alignment.
- Confirm iframe embedding policy if analysts must stay inside the SOC portal tab.
