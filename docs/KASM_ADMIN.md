# Kasm administration checklist

Use this after you push [`docker/kasm-chrome-mitm`](docker/kasm-chrome-mitm) to your registry or load it on agents directly.

## 1. Build and publish the workspace image

From repo root:

```bash
docker build -t your-registry/soc/kasm-chrome-mitm:1.0 \
  -f docker/kasm-chrome-mitm/Dockerfile docker/kasm-chrome-mitm
docker push your-registry/soc/kasm-chrome-mitm:1.0
```

Pin `KASM_CHROME_TAG` in the Dockerfile to the **same minor release** as your Kasm deployment.

## 2. Optional — Workspace Registry URL (GUI)

You can ship the workspace definition through a **Kasm Workspace Registry** instead of hand-entering JSON for each image:

1. Use the private registry repo created from this project’s [`kasm-registry-repo`](kasm-registry-repo/) template (remote example: [github.com/cmdss1/soc-analysis-kasm-registry](https://github.com/cmdss1/soc-analysis-kasm-registry), branch **`1.1`**).
2. Edit [`workspaces/SOC_Chrome_MITM/workspace.json`](kasm-registry-repo/workspaces/SOC_Chrome_MITM/workspace.json): set `docker_registry` + `image` for your registry (**GHCR**: `https://ghcr.io` + `your-user/kasm-chrome-mitm:1.0`; **Docker Hub**: `https://index.docker.io/v1/` + short name). Paths must be **lowercase**. See [`kasm-registry-repo/SOC_REGISTRY_SETUP.md`](kasm-registry-repo/SOC_REGISTRY_SETUP.md) for GHCR push steps.
3. Ensure **GitHub Actions** are enabled and wait for **Build** → deploy to **`gh-pages`**.
4. **Settings → Pages → Build and deployment:** Source = branch **`gh-pages`**, folder **`/`** (root), Save. Without this step the registry URL will not load even after Actions succeeds.
5. Paste this **site root** URL into Kasm (not `/1.1/` — Kasm compares it to `list_url` in `list.json` and will error with “valid schema list” if they disagree):

   **`https://cmdss1.github.io/soc-analysis-kasm-registry/`**

   After Actions deploy, sanity-check [`.../1.1/list.json`](https://cmdss1.github.io/soc-analysis-kasm-registry/1.1/list.json): the `list_url` field inside should match the root URL above.
6. In Kasm Admin → Workspaces → **Registries** / **Registre**, paste that URL (same pattern as **Registernotat-URL**) and install.

The catalog site on `github.io` is **public even if the repo is private**; only git history stays private. Image pulls still use credentials configured in Kasm for your Docker registry.

See [`kasm-registry-repo/SOC_REGISTRY_SETUP.md`](kasm-registry-repo/SOC_REGISTRY_SETUP.md).

## 3. Register the image in Kasm Admin UI

1. Admin → Workspaces → Workspaces → **Add Workspace**
2. Point Docker registry / image to `your-registry/soc/kasm-chrome-mitm:1.0`
3. Assign cores/memory disk quotas suitable for Chrome investigations
4. Restrict uploads/downloads/clipboard per your SOC policy
5. Attach the workspace to the analyst group that the orchestrator’s **Developer API** sessions target

## 4. Developer API key

1. Admin → Developers → **API Keys**
2. Grant **`Users Auth Session`** + **`User`** (needed for [`POST /api/public/request_kasm`](https://docs.kasm.com/docs/developers/developer_api/index.html))
3. Store key + secret in the orchestrator environment (`KASM_API_KEY`, `KASM_API_SECRET`)

Resolve **`image_id`** via [`POST /api/public/get_images`](https://docs.kasm.com/docs/developers/developer_api/index.html) (or UI → workspace UUID).

Resolve **`user_id`** for the mapped analyst/service principal analogously (`get_users`, SSO-linked accounts, etc.).

## 5. Networking collectors vs workspaces

Kasm sessions must resolve **`PUBLIC_API_BASE`** (configured server-side) to an IP/host reachable **from inside spawned containers**:

| Topology | Typical setting |
| --- | --- |
| Docker Desktop agents | `http://host.docker.internal:8000` |
| Linux Docker bridge | Publish collector on LAN IP (for example `http://10.0.0.12:8000`) |
| Kubernetes agents | Cluster DNS/service hostname |

Firewall **`POST /api/v1/collector/ingest`** so only workspace egress ranges may reach it.

## 6. Operational reminders

- **Idle/expiry**: Align sandbox TTL with SOC retention policies; optionally hook **`destroy_kasm`** from UI/session teardown flows ([`/api/public/destroy_kasm`](https://docs.kasm.com/docs/developers/developer_api/index.html)).
- **Embedding**: Many SSO setups ship restrictive **`Content-Security-Policy`** / framing headers—the SOC UI supports launching Kasm in a **new tab** when iframe embedding fails.
- **Pinned TLS**: Sites using certificate pinning may refuse TLS interception even with the injected MITM CA; flows still appear with degraded fidelity—communicate this expectation to analysts.

## 7. Join fails (“connection error” / streaming toast)

If Admin shows **running** but joining from the Workspaces UI shows errors such as **“Feil ved oppretting/fortsettelse av økt”** (session create/resume) or **“Tilkoblingsfeil”** while requesting or reconnecting to KasmVNC, the container exists — **browser streaming configuration does not**. The SOC orchestrator only influences provisioning (Developer API); fixing joins is done inside **Kasm Admin**.

Priority checks:

| Area | What to verify |
| --- | --- |
| **Deployment zone — Proxy Port** | Kasm sets streaming URLs relative to the zone **proxy port seen by the browser**. If you browse **`https://192.168.0.177:6333`**, the zone **Proxy Port** must be **6333**, not `443`, unless you truly terminate HTTPS on 443 and never expose 6333 to clients. A mismatch causes joins and resumes to fail. |
| **Deployment zone — Proxy Hostname** | Usually **`$request_host$`** or the exact LAN/IP hostname analysts use in the address bar. If hostname/IP mixes are wrong (login via hostname but UI redirects streams via unreachable Docker/internal DNS names), streaming breaks. |
| **Reverse proxy / Unraid** | Anything in front of Kasm must **allow WebSockets** (`Upgrade`, long-lived connections). Half-loaded sessions are commonly nginx/cloudflare misconfig. See Kasm [Reverse Proxies](https://docs.kasm.com/docs/latest/guide/troubleshooting/reverse_proxies/index.html). |
| **Cookies / hostname discipline** | Use **one origin** for the whole session (same scheme + host + port). Multiple tabs or logging in via `localhost` vs LAN IP vs hostname causes **`username` / `session_token` cookie conflicts**. Try **private/incognito** once with extensions off. |
| **After zone edits** | **Destroy** existing sessions and **launch new ones**; resumed sessions may keep old connection metadata. |

**Stuck on “creating secure connection” (~30–60s), then Norwegian connection error**

That phase is the **browser** (your PC) opening the **KasmVNC / desktop WebSocket** to your deployment — **before** Chrome inside the workspace matters.

| Step | Action |
| --- | --- |
| **A/B test** | Launch **stock “Kasm Chrome”** (or any official browser workspace) on the **same zone**. If **that also hangs**, treat this as **zone / proxy / WebSocket / Unraid routing**, not the MITM image. |
| **DevTools → Network → WS** | While connecting, watch websocket rows (`desktop`, `websockify`, `vnc`). **Failed / stuck pending** with wrong host or port confirms zone/proxy mismatch or blocked upgrades. |
| **Hostname discipline** | Log in and launch using **exactly one origin** (same scheme + host + port). Mixing **`https://192.168.0.177:6333`** with a hostname or `localhost` often breaks cookies → handshake timeouts. Try **incognito** with extensions off. |
| **Zone hostname experiment** | In **Deployment Zone**, temporarily set **Proxy Hostname** to the literal IP/host clients use (e.g. **`192.168.0.177`**) instead of only **`$request_host$`** if you suspect hostname normalization/DNS issues. Recreate sessions after saving. |
| **Logs** | On the server: **`kasm_proxy`**, **`kasm_agent`**, and **`kasm_api`** container logs during repro often show **403**, missing cookies, or **upstream/agent unreachable**. |

Official deep dive: [Advanced Connection Troubleshooting](https://docs.kasm.com/docs/guide/troubleshooting/advanced_connection_troubleshooting/index.html) and [Deployment Zones](https://docs.kasm.com/docs/latest/guide/deployment_zones/index.html).

If streaming works after launching **Workspace → Add Session** from the UI but fails only when opening links returned by the SOC API, compare the URL host/port with your zone settings — they must agree.

## 8. SOC Chrome (MITM) image — join works for stock Chrome but not this workspace

If **Kasm Chrome** (stock) streams fine but **SOC Chrome (MITM)** errors during connect:

| Issue | What to do |
| --- | --- |
| **Wrong `kasmweb/chrome` base tag** | Rebuild [`docker/kasm-chrome-mitm`](docker/kasm-chrome-mitm) with `KASM_CHROME_TAG` matching your deployment (**Admin → About**). Mismatched minors often provision a container then fail at stream handshake. |
| **Global proxy `ENV` in the image** | Older revisions set `HTTP_PROXY` / `HTTPS_PROXY` to `127.0.0.1:8080` for the whole container. Many stacks honor that and break internal/agent traffic. **Chrome-only** proxy belongs in [`chrome-policies/managed/mitm-proxy.json`](docker/kasm-chrome-mitm/chrome-policies/managed/mitm-proxy.json). Use a current Dockerfile that does **not** set those env vars. |
| **Runs as root at runtime** | Upstream **`kasmweb/chrome`** ends with **`USER 1000`**. If your Dockerfile stays on **`USER root`**, KasmVNC/XFCE/Chrome paths break and streaming fails while stock Chrome works. End the image with **`USER 1000`** and put mitm **`confdir`** somewhere writable by that user (e.g. **`/home/kasm-user/.mitmproxy`**). |

Push an updated image to your registry, refresh the workspace definition if needed, destroy stale sessions, then test again.
