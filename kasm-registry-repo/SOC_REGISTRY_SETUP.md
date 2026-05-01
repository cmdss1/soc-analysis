# SOC Chrome workspace registry

This repository was bootstrapped from [kasmtech/workspaces_registry_template](https://github.com/kasmtech/workspaces_registry_template) (schema branch **1.1**) for GitHub Pages.

## Registry URL for Kasm GUI

After GitHub Actions completes (`Build` workflow → `gh-pages` branch):

1. Open **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, branch **`gh-pages`**, folder **`/`** (root), then **Save**.
2. In Kasm Admin → Workspaces → Registries, paste **only the GitHub Pages site root** (same pattern as the official store):

   **`https://cmdss1.github.io/soc-analysis-kasm-registry/`**

   Do **not** use `/1.1/` here. That path is where `list.json` is hosted, but Kasm validates `list.json`’s `list_url` against what you paste; it must match this **root** URL (see how the official registry uses `list_url`: `https://registry.kasmweb.com/` without `/1.1/`).

3. Optional: open the site in a browser, click **Workspace Registry Link** — it should copy that same root URL.
4. Finish **Installer** / **Add** in Kasm.

If you still see **Registreringsfeil / valid schema list**, wait for the latest Actions deploy (refresh registry), confirm [`https://cmdss1.github.io/soc-analysis-kasm-registry/1.1/list.json`](https://cmdss1.github.io/soc-analysis-kasm-registry/1.1/list.json) loads, and check that `list_url` inside that JSON equals the root URL above.

## Publish image via GitHub Actions (recommended)

The SOC analysis monorepo ships [`.github/workflows/publish-kasm-chrome-mitm.yml`](../.github/workflows/publish-kasm-chrome-mitm.yml). On GitHub it builds `docker/kasm-chrome-mitm` and pushes **`ghcr.io/<repo-owner-lowercase>/kasm-chrome-mitm:1.0`** (and **`:latest`**), using `GITHUB_TOKEN` (**Settings → Actions → General**: workflow permissions must allow **read and write** for packages).

1. Push the monorepo to GitHub (workflow file included).
2. **Actions** → **Publish Kasm Chrome MITM (GHCR)** → **Run workflow**, or push any change under `docker/kasm-chrome-mitm/`.
3. **Packages** → **`kasm-chrome-mitm`** → set **Public** for anonymous Kasm pulls, or keep **Private** and add GHCR credentials in Kasm (below).
4. In [`workspaces/SOC_Chrome_MITM/workspace.json`](workspaces/SOC_Chrome_MITM/workspace.json), set every **`image`** to **`OWNER/kasm-chrome-mitm:1.0`** where **`OWNER`** is that same lowercase GitHub user/org (must match the workflow output). The checked-in example uses **`cmdss1`** — replace it if your GitHub owner differs.

Commit here and run this repo’s **Build** workflow so Pages picks up the updated catalog.

## Docker image (GHCR)

The catalog defaults to **GitHub Container Registry** (`docker_registry`: `https://ghcr.io`). The `image` field is **`OWNER/IMAGE_NAME:tag`** (no `ghcr.io/` prefix); Kasm combines it with `docker_registry`.

### 1. Build and push (manual alternative)

From your **SOC analysis** repo root (where `docker/kasm-chrome-mitm` lives):

```bash
docker build -t ghcr.io/YOUR_GITHUB_USER/kasm-chrome-mitm:1.0 \
  -f docker/kasm-chrome-mitm/Dockerfile docker/kasm-chrome-mitm
docker push ghcr.io/YOUR_GITHUB_USER/kasm-chrome-mitm:1.0
```

Use the **same lowercase** `YOUR_GITHUB_USER` as your GitHub username or org (Docker/GitHub reject mixed-case paths).

### 2. Login to GHCR

```bash
echo YOUR_GITHUB_PAT | docker login ghcr.io -u YOUR_GITHUB_USER --password-stdin
```

Create a classic PAT with **`write:packages`** (and **`read:packages`**); for org-owned packages you may need org permission to publish.

### 3. Package visibility

On GitHub → **Packages** → the package → **Package settings**: set **visibility** to **Public** if you want anonymous pulls from Kasm, or keep it **Private** and add registry credentials in Kasm (below).

### 4. Edit `workspace.json`

Edit [`workspaces/SOC_Chrome_MITM/workspace.json`](workspaces/SOC_Chrome_MITM/workspace.json):

- Set every `"image"` to `OWNER/kasm-chrome-mitm:1.0` where **OWNER** matches the GHCR path you pushed (same as GitHub repo owner, lowercase). Must match [Actions publish](../.github/workflows/publish-kasm-chrome-mitm.yml) if you use that workflow.
- Leave `"docker_registry"` as `https://ghcr.io` for GHCR.
- Tune `uncompressed_size_mb` after you measure the image.

### 5. Kasm credentials (private packages only)

Admin → Workspaces → **Credentials** (or Docker registry credentials): registry **`https://ghcr.io`**, username = GitHub username, password = PAT with **`read:packages`**. Attach that credential to the workspace’s registry pull settings if your UI requires it.

### Docker Hub instead

If you switch back to Docker Hub: set `"docker_registry"` to `https://index.docker.io/v1/` and `"image"` to `yourhubuser/kasm-chrome-mitm:1.0`.

## Repository visibility

GitHub Pages sites are **publicly readable** on github.io unless you use Enterprise controls. Only the **Git repo** can stay private. Do not put secrets in `workspace.json`; image pulls still require your registry credentials in Kasm.

## Default branch

This registry expects development on branch **`1.1`** (Kasm schema version). Set it as the default branch in GitHub if prompted.
