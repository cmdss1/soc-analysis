# MITM → collector event shapes

The mitmproxy addon [`docker/kasm-chrome-mitm/mitm_addon.py`](docker/kasm-chrome-mitm/mitm_addon.py) POSTs JSON objects to `SOC_COLLECTOR_URL` (typically `/api/v1/collector/ingest`).

Every payload must include **`session_id`** matching `SOC_SESSION_ID`, matching the bearer **`SOC_INGEST_TOKEN`**.

## Types

### `http_connect`

Emitted for HTTPS CONNECT tunnels.

| Field | Notes |
| --- | --- |
| `host`, `port` | Upstream target |
| `client_ip` | Local Chrome connection |

### `http_request`

| Field | Notes |
| --- | --- |
| `request_id` | UUID correlating response |
| `method`, `scheme`, `host`, `port`, `path` | Request line metadata |
| `headers` | Header dict |
| `body_len`, `body_preview` | Preview capped by `SOC_MAX_BODY_BYTES` (default 65536) |

### `http_response`

| Field | Notes |
| --- | --- |
| `request_id` | Matches request |
| `status_code`, `reason`, `headers` | Response metadata |
| `tls` | mitmproxy server TLS summary (`tls_established`, `tls_version`, `alpn`, `sni`) |
| `server_cert` | Issuer/subject/serial summary |
| `server_address` | Resolved upstream `(host, port)` |

All records include an RFC3339 **`ts`** set server-side at ingest if missing.
