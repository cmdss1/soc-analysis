"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { eventsUrl, fetchSession } from "@/lib/api";

type MitmEvent = {
  type?: string;
  session_id?: string;
  ts?: string;
  request_id?: string;
  method?: string;
  host?: string;
  port?: number;
  path?: string;
  scheme?: string;
  status_code?: number;
  reason?: string;
  tls?: Record<string, unknown>;
  server_cert?: Record<string, unknown>;
  server_address?: unknown;
  client_ip?: string;
  body_len?: number;
  body_preview?: string;
};

type FlowRow = {
  request_id: string;
  method?: string;
  host?: string;
  path?: string;
  scheme?: string;
  status_code?: number;
  tls?: Record<string, unknown>;
  server_cert?: Record<string, unknown>;
  server_address?: unknown;
  req_preview?: string;
  resp_preview?: string;
  req_len?: number;
  resp_len?: number;
};

function mergeFlow(prev: FlowRow, ev: MitmEvent): FlowRow {
  const next = { ...prev };
  if (ev.method) next.method = ev.method;
  if (ev.host) next.host = ev.host;
  if (ev.path) next.path = ev.path;
  if (ev.scheme) next.scheme = ev.scheme;
  if (ev.status_code != null) next.status_code = ev.status_code;
  if (ev.tls) next.tls = ev.tls;
  if (ev.server_cert) next.server_cert = ev.server_cert;
  if (ev.server_address != null) next.server_address = ev.server_address;
  if (ev.body_preview != null && ev.type === "http_request") {
    next.req_preview = ev.body_preview;
    next.req_len = ev.body_len;
  }
  if (ev.body_preview != null && ev.type === "http_response") {
    next.resp_preview = ev.body_preview;
    next.resp_len = ev.body_len;
  }
  return next;
}

export default function SessionWorkspace({
  sessionId,
}: {
  sessionId: string;
}) {
  const [meta, setMeta] = useState<{
    target_url: string;
    kasm_viewer_url: string | null;
  } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [flows, setFlows] = useState<Map<string, FlowRow>>(() => new Map());
  const [connects, setConnects] = useState<MitmEvent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSession(sessionId);
        if (!cancelled) {
          setMeta({
            target_url: s.target_url,
            kasm_viewer_url: s.kasm_viewer_url,
          });
        }
      } catch {
        if (!cancelled) setLoadErr("Could not load session metadata.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const src = new EventSource(eventsUrl(sessionId));
    src.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as MitmEvent;
        setLiveErr(null);
        if (ev.type === "http_connect") {
          setConnects((c) => [...c.slice(-199), ev]);
          return;
        }
        if (ev.type === "http_request" && ev.request_id) {
          setFlows((prev) => {
            const n = new Map(prev);
            const cur = n.get(ev.request_id!) || { request_id: ev.request_id! };
            n.set(ev.request_id!, mergeFlow(cur, ev));
            return n;
          });
          return;
        }
        if (ev.type === "http_response" && ev.request_id) {
          setFlows((prev) => {
            const n = new Map(prev);
            const cur = n.get(ev.request_id!) || { request_id: ev.request_id! };
            n.set(ev.request_id!, mergeFlow(cur, ev));
            return n;
          });
        }
      } catch {
        setLiveErr("Malformed SSE payload");
      }
    };
    src.onerror = () => {
      setLiveErr("SSE disconnected — refresh if flows stall.");
    };
    return () => src.close();
  }, [sessionId]);

  const rows = useMemo(
    () =>
      Array.from(flows.values()).sort((a, b) =>
        a.request_id.localeCompare(b.request_id),
      ),
    [flows],
  );

  const detail = selected ? flows.get(selected) : undefined;

  const viewer = meta?.kasm_viewer_url;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          background: "var(--panel)",
        }}
      >
        <Link href="/" style={{ textDecoration: "none", color: "var(--muted)" }}>
          ← New session
        </Link>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Session <code>{sessionId.slice(0, 8)}…</code>
        </span>
        {meta ? (
          <span style={{ fontSize: 13 }}>
            Target:{" "}
            <code style={{ color: "var(--accent)" }}>{meta.target_url}</code>
          </span>
        ) : null}
        {viewer ? (
          <a href={viewer} target="_blank" rel="noreferrer">
            Open Kasm in new tab
          </a>
        ) : null}
      </header>

      {loadErr ? (
        <p style={{ padding: 16, color: "#f85149" }}>{loadErr}</p>
      ) : null}
      {liveErr ? (
        <p style={{ padding: "0 16px", color: "var(--warn)", fontSize: 13 }}>
          {liveErr}
        </p>
      ) : null}

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "minmax(360px, 1fr) minmax(420px, 1.1fr)",
          gap: 0,
          minHeight: 0,
        }}
      >
        <section
          style={{
            borderRight: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            background: "#0d1117",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--muted)",
            }}
          >
            Kasm desktop {viewer ? "(embedded where allowed)" : "(waiting URL)"}
          </div>
          <div style={{ flex: 1, position: "relative", minHeight: 420 }}>
            {viewer && viewer !== "about:blank" ? (
              <iframe
                title="Kasm session"
                src={viewer}
                style={{
                  border: "none",
                  width: "100%",
                  height: "100%",
                  minHeight: 480,
                  background: "#000",
                }}
              />
            ) : (
              <div style={{ padding: 24, color: "var(--muted)", lineHeight: 1.6 }}>
                <p>
                  No viewer URL yet. Kasm often omits the link until the session is{" "}
                  <strong>running</strong> — wait a few seconds and refresh this page, or
                  check that <code>KASM_BASE_URL</code> matches your server and the backend
                  can call <code>get_kasm_status</code>.
                </p>
                <p style={{ marginTop: 12 }}>
                  When a link is returned, it appears here if framing is allowed; otherwise
                  use <strong>Open Kasm in new tab</strong>.{" "}
                  <span style={{ opacity: 0.85 }}>
                    (Mock mode uses <code>about:blank</code>.)
                  </span>
                </p>
              </div>
            )}
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              fontWeight: 600,
              background: "var(--panel)",
            }}
          >
            Network / MITM (Chrome via mitmproxy)
          </div>

          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                borderRight: "1px solid var(--border)",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                    <th style={{ padding: 8 }}>Method</th>
                    <th style={{ padding: 8 }}>Host</th>
                    <th style={{ padding: 8 }}>Path</th>
                    <th style={{ padding: 8 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.request_id}
                      onClick={() => setSelected(r.request_id)}
                      style={{
                        cursor: "pointer",
                        background:
                          selected === r.request_id ? "#21262d" : "transparent",
                        borderTop: "1px solid var(--border)",
                      }}
                    >
                      <td style={{ padding: 8 }}>{r.method || "—"}</td>
                      <td style={{ padding: 8 }}>{r.host || "—"}</td>
                      <td
                        style={{
                          padding: 8,
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.path || "—"}
                      </td>
                      <td style={{ padding: 8 }}>
                        {r.status_code != null ? (
                          <span
                            style={{
                              color:
                                r.status_code >= 400 ? "#f85149" : "var(--ok)",
                            }}
                          >
                            {r.status_code}
                          </span>
                        ) : (
                          "…"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ width: "42%", minWidth: 260, overflow: "auto" }}>
              <div style={{ padding: 12, fontSize: 12 }}>
                <div style={{ marginBottom: 12, color: "var(--muted)" }}>
                  CONNECT tunnels ({connects.length})
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)" }}>
                  {connects.slice(-20).map((c, i) => (
                    <li key={i}>
                      {c.host}:{c.port}{" "}
                      {c.client_ip ? <span>from {c.client_ip}</span> : null}
                    </li>
                  ))}
                </ul>

                <hr style={{ borderColor: "var(--border)", margin: "16px 0" }} />

                {detail ? (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>
                      Flow detail
                    </div>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        background: "#0d1117",
                        padding: 12,
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                      }}
                    >
                      {JSON.stringify(detail, null, 2)}
                    </pre>
                  </>
                ) : (
                  <span style={{ color: "var(--muted)" }}>
                    Select a row for TLS metadata and previews.
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
