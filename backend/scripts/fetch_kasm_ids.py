"""One-off: read backend/.env and print workspace/user IDs from Kasm Developer API."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" in s:
            k, v = s.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    env_path = root / ".env"
    e = load_env(env_path)
    base = e.get("KASM_BASE_URL", "").rstrip("/")
    if not base:
        print("KASM_BASE_URL missing", file=sys.stderr)
        return 2
    verify = str(e.get("KASM_VERIFY_TLS", "true")).lower() not in ("false", "0", "no")
    payload = {"api_key": e["KASM_API_KEY"], "api_key_secret": e["KASM_API_SECRET"]}
    try:
        with httpx.Client(timeout=45.0, verify=verify) as c:
            gi = c.post(f"{base}/api/public/get_images", json=payload)
            gu = c.post(f"{base}/api/public/get_users", json=payload)
    except httpx.ConnectError as exc:
        print(f"Cannot reach Kasm at {base}: {exc}", file=sys.stderr)
        return 3
    print("get_images", gi.status_code)
    print("get_users", gu.status_code)
    if gi.status_code >= 400:
        print(gi.text[:800], file=sys.stderr)
        return 4
    imgs = gi.json()
    users_obj: dict | list | None = None
    if gu.status_code >= 400:
        print(
            "get_users failed — add API permission **Users View** or paste KASM_USER_ID from Admin → Users.",
            file=sys.stderr,
        )
    else:
        users_obj = gu.json()

    print(json.dumps({"images_sample_keys": list(imgs.keys()) if isinstance(imgs, dict) else None}, indent=2))
    if users_obj is not None:
        print(
            json.dumps(
                {"users_sample_keys": list(users_obj.keys()) if isinstance(users_obj, dict) else None},
                indent=2,
            )
        )

    def iter_rows(blob: object):
        if isinstance(blob, dict):
            for key in ("images", "users", "data", "kasms"):
                inner = blob.get(key)
                if isinstance(inner, list):
                    yield from inner
            if "images" not in blob and "users" not in blob:
                # flat dict of id -> row
                for v in blob.values():
                    if isinstance(v, list):
                        yield from v
        elif isinstance(blob, list):
            yield from blob

    print("--- workspaces/images (id + name hints) ---")
    for row in iter_rows(imgs):
        if not isinstance(row, dict):
            continue
        iid = row.get("image_id") or row.get("id")
        name = row.get("friendly_name") or row.get("name") or row.get("image_src")
        if iid:
            print(f"  {iid}\t{name}")

    print("--- users ---")
    if users_obj is None:
        print("  (skipped)")
    else:
        for row in iter_rows(users_obj):
            if not isinstance(row, dict):
                continue
            uid = row.get("user_id") or row.get("id")
            name = row.get("username") or row.get("name") or row.get("email")
            if uid:
                print(f"  {uid}\t{name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
