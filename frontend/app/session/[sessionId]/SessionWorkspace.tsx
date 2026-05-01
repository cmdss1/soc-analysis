"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { eventsUrl, fetchSession } from "@/lib/api";

type MitmEvent = {
  type?: string;
  ts?: string;
  request_id?: string;
  method?: string;
  host?: string;
  port?: number;
  path?: string;
  scheme?: string;
  status_code?: number;
  reason?: string;
  content_type?: string | null;
  tls?: {
    tls_established?: boolean;
    tls_version?: string | null;
    alpn?: string | null;
    sni?: string | null;
  };
  server_cert?: {
    subject?: string | null;
    issuer?: string | null;
    serial?: string | null;
  };
  server_ip?: string | null;
  server_port?: number | null;
  server_host?: string | null;
  client_ip?: string | null;
  body_len?: number;
  body_preview?: string;
};

type FlowRow = {
  request_id: string;
  ts: string;
  method?: string;
  host?: string;
  path?: string;
  scheme?: string;
  status_code?: number;
  content_type?: string | null;
  tls?: MitmEvent["tls"];
  server_cert?: MitmEvent["server_cert"];
  server_ip?: string | null;
  server_port?: number | null;
  req_preview?: string;
  resp_preview?: string;
  req_len?: number;
  resp_len?: number;
};

function isHttpViewerUrl(v: string | null | undefined): v is string {
  return Boolean(v && (v.startsWith("http://") || v.startsWith("https://")));
}

function mergeFlow(prev: FlowRow, ev: MitmEvent): FlowRow {
  const next = { ...prev };
  if (ev.method) next.method = ev.method;
  if (ev.host) next.host = ev.host;
  if (ev.path) next.path = ev.path;
  if (ev.scheme) next.scheme = ev.scheme;
  if (ev.status_code != null) next.status_code = ev.status_code;
  if (ev.content_type !== undefined) next.content_type = ev.content_type;
  if (ev.tls) next.tls = ev.tls;
  if (ev.server_cert) next.server_cert = ev.server_cert;
  if (ev.server_ip !== undefined) next.server_ip = ev.server_ip;
  if (ev.server_port !== undefined) next.server_port = ev.server_port;
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

function statusColor(s?: number): string {
  if (s == null) return "var(--muted)";
  if (s >= 500) return "#f85149";
  if (s >= 400) return "#d29922";
  if (s >= 300) return "#58a6ff";
  return "var(--ok)";
}

function fmtBytes(n?: number): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function shortType(ct?: string | null): string {
  if (!ct) return "";
  return ct.split(";")[0].trim();
}

type HostRow = {
  host: string;
  ips: Set<string>;
  count: number;
  scheme?: string;
  firstTs: string;
  lastTs: string;
  hasError: boolean;
};

export default function SessionWorkspace({
  sessionId,
}: {
  sessionId: string;
}) {
  const [meta, setMeta] = useState<{
    target_url: string;
    kasm_viewer_url: string | null;
    kasm_id: string | null;
  } | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [flows, setFlows] = useState<Map<string, FlowRow>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"flows" | "hosts" | "detail">("flows");
  const [filter, setFilter] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    async function run() {
      while (!cancelled && tries < 90) {
        try {
          const s = await fetchSession(sessionId);
          if (cancelled) return;
          setLoadErr(null);
          setMeta({
            target_url: s.target_url,
            kasm_viewer_url: s.kasm_viewer_url,
            kasm_id: s.kasm_id,
          });
          if (isHttpViewerUrl(s.kasm_viewer_url)) return;
        } catch {
          if (!cancelled) setLoadErr("Could not load session metadata.");
          return;
        }
        tries += 1;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    run();
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
        if (ev.type === "http_request" || ev.type === "http_response") {
          if (!ev.request_id) return;
          setFlows((prev) => {
            const n = new Map(prev);
            const cur =
              n.get(ev.request_id!) || {
                request_id: ev.request_id!,
                ts: ev.ts || new Date().toISOString(),
              };
            n.set(ev.request_id!, mergeFlow(cur, ev));
            return n;
          });
        }
      } catch {
        setLiveErr("Malformed SSE payload");
      }
    };
    src.onerror = () => setLiveErr("SSE disconnected — refresh if flows stall.");
    return () => src.close();
  }, [sessionId]);

  const rows = useMemo(() => {
    const arr = Array.from(flows.values());
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
    if (!filter.trim()) return arr;
    const q = filter.trim().toLowerCase();
    return arr.filter(
      (r) =>
        r.host?.toLowerCase().includes(q) ||
        r.path?.toLowerCase().includes(q) ||
        r.server_ip?.toLowerCase().includes(q) ||
        String(r.status_code ?? "").includes(q),
    );
  }, [flows, filter]);

  const hosts = useMemo<HostRow[]>(() => {
    const m = new Map<string, HostRow>();
    for (const f of flows.values()) {
      if (!f.host) continue;
      const cur = m.get(f.host) || {
        host: f.host,
        ips: new Set<string>(),
        count: 0,
        scheme: f.scheme,
        firstTs: f.ts,
        lastTs: f.ts,
        hasError: false,
      };
      cur.count += 1;
      if (f.server_ip) cur.ips.add(f.server_ip);
      if (f.ts < cur.firstTs) cur.firstTs = f.ts;
      if (f.ts > cur.lastTs) cur.lastTs = f.ts;
      if ((f.status_code || 0) >= 400) cur.hasError = true;
      m.set(f.host, cur);
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [flows]);

  const stats = useMemo(() => {
    let https = 0;
    let errors = 0;
    let total = 0;
    let bytes = 0;
    for (const f of flows.values()) {
      total += 1;
      if (f.scheme === "https" || f.tls?.tls_established) https += 1;
      if ((f.status_code || 0) >= 400) errors += 1;
      bytes += (f.req_len || 0) + (f.resp_len || 0);
    }
    return { total, https, errors, bytes, hosts: hosts.length };
  }, [flows, hosts.length]);

  const detail = selected ? flows.get(selected) : undefined;
  const viewer = meta?.kasm_viewer_url;
  const hasViewer = isHttpViewerUrl(viewer);
  let viewerOriginLabel = "";
  if (hasViewer) {
    try {
      viewerOriginLabel = new URL(viewer).hostname;
    } catch {
      viewerOriginLabel = viewer;
    }
  }

  return (
    <div className="soc-root">
      <header className="soc-header">
        <Link href="/" className="soc-back">
          ← New
        </Link>
        <div className="soc-title">
          <strong>SOC Sandbox</strong>
          <span className="soc-id">
            {sessionId.slice(0, 8)} · kasm {meta?.kasm_id?.slice(0, 8) || "—"}
          </span>
        </div>
        <div className="soc-target">
          <span className="soc-label">Target</span>
          <code>{meta?.target_url || "…"}</code>
        </div>
        <div className="soc-stats">
          <Stat label="Flows" value={stats.total} />
          <Stat label="Hosts" value={stats.hosts} />
          <Stat label="HTTPS" value={`${stats.https}/${stats.total || 0}`} />
          <Stat
            label="Errors"
            value={stats.errors}
            color={stats.errors > 0 ? "#f85149" : undefined}
          />
          <Stat label="Bytes" value={fmtBytes(stats.bytes)} />
        </div>
        {hasViewer ? (
          <a
            href={viewer}
            target="_blank"
            rel="noreferrer"
            className="soc-newtab"
            title={viewerOriginLabel}
          >
            Open in new tab ↗
          </a>
        ) : null}
      </header>

      {loadErr ? <p className="soc-error">{loadErr}</p> : null}
      {liveErr ? <p className="soc-warn">{liveErr}</p> : null}

      <div className="soc-grid">
        <section className="soc-viewer">
          {hasViewer ? (
            <iframe
              title="Kasm session"
              src={viewer}
              allow="clipboard-read; clipboard-write; fullscreen; autoplay"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock allow-downloads"
            />
          ) : (
            <div className="soc-placeholder">
              <p>
                Provisioning Kasm workspace… Kasm only returns a viewer URL once
                the container is <strong>running</strong>. This panel rechecks
                automatically.
              </p>
            </div>
          )}
          {hasViewer ? (
            <div className="soc-viewer-foot">
              If the desktop is blank, your Kasm server is denying iframe
              embedding. In Kasm Admin, enable
              <code>Allow Kasm Embedding</code> on the workspace, or click{" "}
              <a href={viewer} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
              .
            </div>
          ) : null}
        </section>

        <section className="soc-panel">
          <nav className="soc-tabs">
            <button
              className={tab === "flows" ? "active" : ""}
              onClick={() => setTab("flows")}
            >
              Flows ({stats.total})
            </button>
            <button
              className={tab === "hosts" ? "active" : ""}
              onClick={() => setTab("hosts")}
            >
              Hosts ({stats.hosts})
            </button>
            <button
              className={tab === "detail" ? "active" : ""}
              onClick={() => setTab("detail")}
              disabled={!detail}
            >
              Detail
            </button>
            <input
              className="soc-filter"
              placeholder="filter host / path / IP / status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </nav>

          {tab === "flows" ? (
            <div className="soc-table-wrap">
              <table className="soc-table">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Host</th>
                    <th>IP</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.request_id}
                      onClick={() => {
                        setSelected(r.request_id);
                        setTab("detail");
                      }}
                      className={selected === r.request_id ? "selected" : ""}
                    >
                      <td>
                        <span className={`soc-method ${r.scheme || ""}`}>
                          {r.method || "—"}
                        </span>
                      </td>
                      <td className="trunc">{r.host || "—"}</td>
                      <td className="ip">{r.server_ip || "—"}</td>
                      <td className="trunc path" title={r.path}>
                        {r.path || "—"}
                      </td>
                      <td style={{ color: statusColor(r.status_code) }}>
                        {r.status_code ?? "…"}
                      </td>
                      <td className="trunc">{shortType(r.content_type)}</td>
                      <td>{fmtBytes(r.resp_len)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty">
                        No flows yet — interact with the workspace.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "hosts" ? (
            <div className="soc-table-wrap">
              <table className="soc-table">
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>Resolved IPs</th>
                    <th>Flows</th>
                    <th>First seen</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {hosts.map((h) => (
                    <tr key={h.host} onClick={() => setFilter(h.host)}>
                      <td className="trunc">{h.host}</td>
                      <td className="ip">
                        {Array.from(h.ips).join(", ") || "—"}
                      </td>
                      <td>{h.count}</td>
                      <td className="muted">
                        {new Date(h.firstTs).toLocaleTimeString()}
                      </td>
                      <td style={{ color: h.hasError ? "#f85149" : "var(--muted)" }}>
                        {h.hasError ? "yes" : "—"}
                      </td>
                    </tr>
                  ))}
                  {hosts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        Waiting for traffic…
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "detail" ? (
            <div className="soc-detail">
              {detail ? (
                <>
                  <h3>
                    <span className={`soc-method ${detail.scheme || ""}`}>
                      {detail.method}
                    </span>{" "}
                    {detail.scheme}://{detail.host}
                    {detail.path}
                  </h3>
                  <div className="kv">
                    <KV label="Status" value={String(detail.status_code ?? "—")} />
                    <KV label="Content-Type" value={detail.content_type ?? "—"} />
                    <KV
                      label="Server IP"
                      value={`${detail.server_ip ?? "—"}${detail.server_port ? ":" + detail.server_port : ""}`}
                    />
                    <KV label="TLS" value={detail.tls?.tls_version ?? "—"} />
                    <KV label="SNI" value={detail.tls?.sni ?? "—"} />
                    <KV label="ALPN" value={detail.tls?.alpn ?? "—"} />
                    <KV
                      label="Cert subject"
                      value={detail.server_cert?.subject ?? "—"}
                    />
                    <KV
                      label="Cert issuer"
                      value={detail.server_cert?.issuer ?? "—"}
                    />
                    <KV
                      label="Sizes"
                      value={`req ${fmtBytes(detail.req_len)} · resp ${fmtBytes(detail.resp_len)}`}
                    />
                  </div>
                  {detail.req_preview ? (
                    <>
                      <h4>Request body preview</h4>
                      <pre>{detail.req_preview}</pre>
                    </>
                  ) : null}
                  {detail.resp_preview ? (
                    <>
                      <h4>Response body preview</h4>
                      <pre>{detail.resp_preview}</pre>
                    </>
                  ) : null}
                </>
              ) : (
                <p className="muted">Select a flow to inspect.</p>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="soc-stat">
      <span className="soc-stat-label">{label}</span>
      <span className="soc-stat-value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv-row">
      <span className="kv-k">{label}</span>
      <span className="kv-v" title={value}>
        {value}
      </span>
    </div>
  );
}
