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
2. Grant **`Users Auth Session`** + **`User`** (needed for [`POST /api/public/create_session`](https://docs.kasm.com/docs/developers/developer_api/index.html))
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
