"""Full Kasm Developer API audit using backend/.env (read-only; no request_kasm).

Run from backend/:  python scripts/kasm_setup_check.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

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


def redact_blob(s: str, max_len: int = 120) -> str:
    """Shorten JWT-like tail segments in Kasm viewer paths."""
    if len(s) <= max_len:
        return s
    return s[:max_len] + "…"


def sanitize_status(obj: dict[str, Any]) -> dict[str, Any]:
    """Drop huge secrets from get_kasm_status-style payloads."""
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if k in ("session_token", "share_token"):
            out[k] = "<redacted>" if v else None
            continue
        if k == "kasm_url" and isinstance(v, str):
            out[k] = redact_blob(v, 100)
            continue
        if k == "kasm" and isinstance(v, dict):
            inner = dict(v)
            for ik in ("session_token", "token", "view_only_token"):
                if ik in inner and inner[ik]:
                    inner[ik] = "<redacted>"
            if isinstance(inner.get("kasm_url"), str):
                inner["kasm_url"] = redact_blob(inner["kasm_url"], 100)
            out[k] = inner
            continue
        out[k] = v
    return out


def iter_list_payload(body: dict[str, Any], *keys: str) -> list[Any]:
    for key in keys:
        v = body.get(key)
        if isinstance(v, list):
            return v
    for v in body.values():
        if isinstance(v, list):
            return v
    return []


ZONE_KEYS = (
    "zone_name",
    "zone_id",
    "proxy_hostname",
    "proxy_port",
    "proxy_path",
    "upstream_auth_address",
)


def normalize_uuid(u: str) -> str:
    return u.replace("-", "").lower()


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    env_path = root / ".env"
    e = load_env(env_path)
    base = e.get("KASM_BASE_URL", "").rstrip("/")
    if not base:
        print("KASM_BASE_URL missing", file=sys.stderr)
        return 2
    verify = str(e.get("KASM_VERIFY_TLS", "true")).lower() not in ("false", "0", "no")
    keys = {"api_key": e["KASM_API_KEY"], "api_key_secret": e["KASM_API_SECRET"]}
    cfg_uid = e.get("KASM_USER_ID", "")
    cfg_img = e.get("KASM_IMAGE_ID", "")

    def post(path: str, extra: dict[str, Any] | None = None) -> tuple[int, Any]:
        payload = {**keys, **(extra or {})}
        with httpx.Client(timeout=90.0, verify=verify) as c:
            r = c.post(f"{base}/api/public/{path}", json=payload)
        try:
            body = r.json()
        except Exception:
            body = {"_non_json": r.text[:600]}
        return r.status_code, body

    results: list[tuple[str, int, str]] = []

    def record(name: str, code: int, note: str) -> None:
        results.append((name, code, note))

    print("=== Kasm full API check (read-only) ===")
    print("base_url:", base)
    print("verify_tls:", verify)
    print()

    # --- Phase 1: endpoint probes ---
    probes: list[tuple[str, str, dict[str, Any] | None]] = [
        ("get_zones", "get_zones", {"brief": False}),
        ("get_kasms", "get_kasms", {}),
        ("get_images", "get_images", {}),
        ("get_users", "get_users", {}),
        ("get_staging_configs", "get_staging_configs", {}),
        ("get_cast_configs", "get_cast_configs", {}),
    ]
    if cfg_uid:
        probes.extend(
            [
                ("get_user", "get_user", {"target_user": {"user_id": cfg_uid}}),
                ("get_attributes", "get_attributes", {"target_user": {"user_id": cfg_uid}}),
            ]
        )

    bodies: dict[str, Any] = {}

    for label, path, extra in probes:
        code, body = post(path, extra)
        bodies[label] = body
        if code != 200:
            msg = body if isinstance(body, dict) else str(body)
            err = (
                msg.get("error_message")
                if isinstance(msg, dict)
                else str(msg)[:200]
            )
            record(label, code, err or str(msg)[:120])
            print(f"--- {label} HTTP {code} ---")
            print(json.dumps(msg, indent=2, default=str)[:1500])
            print()
            continue

        record(label, code, "ok")
        print(f"--- {label} HTTP {code} ---")

        if label == "get_zones" and isinstance(body, dict):
            zones = body.get("zones") or []
            print(f"zones: {len(zones)}")
            for z in zones:
                if not isinstance(z, dict):
                    continue
                merged = {k: z.get(k) for k in ZONE_KEYS}
                for k, v in z.items():
                    lk = k.lower()
                    if k in merged:
                        continue
                    if "proxy" in lk or "ssl" in lk or lk.endswith("_port"):
                        merged[k] = v
                merged = {k: v for k, v in merged.items() if v is not None}
                print(json.dumps(merged, indent=2, default=str))

        elif label == "get_kasms" and isinstance(body, dict):
            kasms = body.get("kasms") or []
            print(f"live_sessions: {len(kasms)}")
            for k in kasms[:25]:
                if not isinstance(k, dict):
                    continue
                img = k.get("image") if isinstance(k.get("image"), dict) else {}
                srv = k.get("server") if isinstance(k.get("server"), dict) else {}
                usr = k.get("user") if isinstance(k.get("user"), dict) else {}
                kid = str(k.get("kasm_id") or "")
                print(
                    json.dumps(
                        {
                            "kasm_id": kid[:14] + "…" if len(kid) > 14 else kid,
                            "operational_status": k.get("operational_status"),
                            "friendly_name": img.get("friendly_name"),
                            "username": usr.get("username"),
                            "zone_name": srv.get("zone_name"),
                            "agent_hostname": srv.get("hostname"),
                            "agent_port": srv.get("port"),
                            "container_ip": k.get("container_ip"),
                            "session_stream_port": k.get("port"),
                        },
                        indent=2,
                    )
                )

        elif label == "get_images" and isinstance(body, dict):
            rows = iter_list_payload(body, "images")
            print(f"workspace_images: {len(rows)}")
            for r in rows:
                if not isinstance(r, dict):
                    continue
                print(
                    json.dumps(
                        {
                            "image_id": r.get("image_id"),
                            "friendly_name": r.get("friendly_name"),
                            "name": r.get("name"),
                            "available": r.get("available"),
                            "enabled": r.get("enabled"),
                            "zone_name": r.get("zone_name"),
                        },
                        indent=2,
                    )
                )
            found = any(
                isinstance(r, dict) and r.get("image_id") == cfg_img for r in rows
            )
            if cfg_img and not found:
                print("WARN: KASM_IMAGE_ID not in get_images list.", file=sys.stderr)

        elif label == "get_users" and isinstance(body, dict):
            rows = iter_list_payload(body, "users")
            print(f"users_returned: {len(rows)}")
            for u in rows[:30]:
                if not isinstance(u, dict):
                    continue
                groups = u.get("groups")
                gnames = (
                    [g.get("name") for g in groups if isinstance(g, dict)]
                    if isinstance(groups, list)
                    else []
                )
                print(
                    json.dumps(
                        {
                            "user_id": u.get("user_id"),
                            "username": u.get("username"),
                            "realm": u.get("realm"),
                            "locked": u.get("locked"),
                            "disabled": u.get("disabled"),
                            "groups": gnames,
                            "active_kasms": len(u.get("kasms") or [])
                            if isinstance(u.get("kasms"), list)
                            else 0,
                        },
                        indent=2,
                    )
                )

        elif label == "get_user" and isinstance(body, dict):
            u = body.get("user")
            if isinstance(u, dict):
                kasms = u.get("kasms") or []
                srv = []
                if isinstance(kasms, list):
                    for x in kasms:
                        if isinstance(x, dict) and isinstance(x.get("server"), dict):
                            srv.append(x["server"])
                groups = u.get("groups")
                gnames = (
                    [g.get("name") for g in groups if isinstance(g, dict)]
                    if isinstance(groups, list)
                    else []
                )
                print(
                    json.dumps(
                        {
                            "user_id": u.get("user_id"),
                            "username": u.get("username"),
                            "groups": gnames,
                            "assigned_servers_count": len(u.get("assigned_servers") or [])
                            if isinstance(u.get("assigned_servers"), list)
                            else 0,
                            "kasms_count": len(kasms) if isinstance(kasms, list) else 0,
                            "kasm_server_hints": srv[:5],
                        },
                        indent=2,
                        default=str,
                    )
                )

        elif label == "get_attributes" and isinstance(body, dict):
            ua = body.get("user_attributes")
            if isinstance(ua, dict):
                slim = {
                    "user_id": ua.get("user_id"),
                    "default_image": ua.get("default_image"),
                    "auto_login_kasm": ua.get("auto_login_kasm"),
                    "toggle_control_panel": ua.get("toggle_control_panel"),
                }
                print(json.dumps(slim, indent=2))

        elif label == "get_staging_configs" and isinstance(body, dict):
            cfgs = body.get("staging_configs") or []
            print(f"staging_configs: {len(cfgs)}")
            for c in cfgs[:10]:
                if isinstance(c, dict):
                    print(
                        json.dumps(
                            {
                                "staging_config_id": c.get("staging_config_id"),
                                "zone_name": c.get("zone_name"),
                                "image_friendly_name": c.get("image_friendly_name"),
                                "num_sessions": c.get("num_sessions"),
                                "num_current_sessions": c.get("num_current_sessions"),
                            },
                            indent=2,
                        )
                    )

        elif label == "get_cast_configs" and isinstance(body, dict):
            cfgs = body.get("cast_configs") or []
            print(f"cast_configs: {len(cfgs)}")
            for c in cfgs[:8]:
                if isinstance(c, dict):
                    print(
                        json.dumps(
                            {
                                "cast_config_id": c.get("cast_config_id"),
                                "casting_config_name": c.get("casting_config_name"),
                                "image_friendly_name": c.get("image_friendly_name"),
                                "group_name": c.get("group_name"),
                            },
                            indent=2,
                        )
                    )

        print()

    # --- Phase 2: collect kasm_ids for get_kasm_status ---
    kasm_ids: list[str] = []
    gk = bodies.get("get_kasms")
    if isinstance(gk, dict):
        for row in gk.get("kasms") or []:
            if isinstance(row, dict) and row.get("kasm_id"):
                kasm_ids.append(str(row["kasm_id"]))

    gu = bodies.get("get_user")
    if isinstance(gu, dict):
        u = gu.get("user")
        if isinstance(u, dict):
            for row in u.get("kasms") or []:
                if isinstance(row, dict) and row.get("kasm_id"):
                    kid = str(row["kasm_id"])
                    if kid not in kasm_ids:
                        kasm_ids.append(kid)

    # dedupe preserve order
    seen: set[str] = set()
    uniq = []
    for k in kasm_ids:
        if k not in seen:
            seen.add(k)
            uniq.append(k)
    kasm_ids = uniq

    print("=== get_kasm_status (orchestrator parity) ===")
    if not cfg_uid:
        print("Skip: KASM_USER_ID not set in .env")
    elif not kasm_ids:
        print(
            "No active kasm_ids from get_kasms / get_user; "
            "start a session, then re-run this script."
        )
    else:
        for kid in kasm_ids[:8]:
            code, body = post(
                "get_kasm_status",
                {"user_id": cfg_uid, "kasm_id": kid, "skip_agent_check": False},
            )
            record(f"get_kasm_status({kid[:8]}…)", code, "ok" if code == 200 else str(body)[:80])
            print(f"--- kasm_id {kid[:12]}… HTTP {code} ---")
            if code != 200:
                print(json.dumps(body, indent=2, default=str)[:1200])
            elif isinstance(body, dict):
                print(json.dumps(sanitize_status(body), indent=2, default=str)[:4000])
            print()

    # --- Phase 3: orchestrator .env cross-check ---
    print("=== Cross-check vs orchestrator .env ===")
    print("KASM_IMAGE_ID:", cfg_img)
    print("KASM_USER_ID:", cfg_uid)

    gi = bodies.get("get_images")
    if isinstance(gi, dict) and cfg_img:
        rows = iter_list_payload(gi, "images")
        img_hit = next(
            (r for r in rows if isinstance(r, dict) and r.get("image_id") == cfg_img),
            None,
        )
        print(
            "image_match:",
            "yes"
            if img_hit
            else "NO — update KASM_IMAGE_ID or register workspace",
        )

    gusers = bodies.get("get_users")
    if isinstance(gusers, dict) and cfg_uid:
        rows = iter_list_payload(gusers, "users")
        u_hit = next(
            (
                r
                for r in rows
                if isinstance(r, dict)
                and normalize_uuid(str(r.get("user_id") or ""))
                == normalize_uuid(cfg_uid)
            ),
            None,
        )
        print(
            "user_match:",
            "yes" if u_hit else "NO — user_id missing from get_users response",
        )

    print()
    print("=== Probe summary ===")
    for name, code, note in results:
        status = "PASS" if code == 200 else "FAIL"
        print(f"  [{status}] {name} HTTP {code} {note[:100]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
