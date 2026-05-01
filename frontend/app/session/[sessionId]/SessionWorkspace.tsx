"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  destroySandboxSession,
  eventsUrl,
  fetchSession,
  finalizeSandboxSession,
  screenshotUrl,
  type SandboxRecord,
} from "@/lib/api";

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

function StatusBadge({ status }: { status: SandboxRecord["status"] }) {
  const map: Record<string, { color: string; label: string }> = {
    pending: { color: "#8b97a7", label: "Queued" },
    analyzing: { color: "#d29922", label: "Analyzing" },
    completed: { color: "#3fb950", label: "Completed" },
    failed: { color: "#f85149", label: "Failed" },
  };
  const it = map[status] ?? map.pending;
  return (
    <span className="status-badge" style={{ color: it.color, borderColor: it.color }}>
      <span className="status-dot" style={{ background: it.color }} />
      {it.label}
    </span>
  );
}

export default function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const [rec, setRec] = useState<SandboxRecord | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [flows, setFlows] = useState<Map<string, FlowRow>>(() => new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"hosts" | "flows" | "detail">("hosts");
  const [filter, setFilter] = useState<string>("");
  const [shotV, setShotV] = useState(0);
  const [view, setView] = useState<"live" | "snapshot">("live");

  // Poll session metadata until completed/failed
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    async function loop() {
      while (!cancelled && tries < 120) {
        try {
          const s = await fetchSession(sessionId);
          if (cancelled) return;
          setLoadErr(null);
          setRec(s);
          if (s.has_screenshot) setShotV((v) => v + 1);
          if (s.status === "completed" || s.status === "failed") return;
        } catch {
          if (!cancelled) setLoadErr("Could not load session.");
          return;
        }
        tries += 1;
        await new Promise((r) => setTimeout(r, 2500));
      }
    }
    loop();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    const src = new EventSource(eventsUrl(sessionId));
    src.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as MitmEvent;
        if (ev.type !== "http_request" && ev.type !== "http_response") return;
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
      } catch {
        /* ignore malformed */
      }
    };
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

  const hosts = useMemo(() => {
    const m = new Map<
      string,
      { host: string; ips: Set<string>; count: number; errors: number; scheme?: string }
    >();
    for (const f of flows.values()) {
      if (!f.host) continue;
      const cur = m.get(f.host) || {
        host: f.host,
        ips: new Set<string>(),
        count: 0,
        errors: 0,
        scheme: f.scheme,
      };
      cur.count += 1;
      if (f.server_ip) cur.ips.add(f.server_ip);
      if ((f.status_code || 0) >= 400) cur.errors += 1;
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

  const targetHost = useMemo(() => {
    try {
      return rec ? new URL(rec.target_url).hostname : "";
    } catch {
      return "";
    }
  }, [rec]);

  const targetIp = useMemo(() => {
    if (!targetHost) return undefined;
    const direct = hosts.find((h) => h.host === targetHost);
    if (direct?.ips.size) return Array.from(direct.ips)[0];
    return undefined;
  }, [hosts, targetHost]);

  async function onDestroy() {
    if (!confirm("Destroy this Kasm workspace?")) return;
    await destroySandboxSession(sessionId).catch(() => undefined);
    setRec((r) => (r ? { ...r, status: "completed" } : r));
  }

  async function onFinalize() {
    try {
      const r = await finalizeSandboxSession(sessionId);
      setRec(r);
      if (r.has_screenshot) {
        setShotV((v) => v + 1);
        setView("snapshot");
      }
    } catch {
      /* noop */
    }
  }

  // Auto-flip to snapshot once available and analysis is done.
  useEffect(() => {
    if (rec?.status === "completed" && rec.has_screenshot) setView("snapshot");
  }, [rec?.status, rec?.has_screenshot]);

  return (
    <div className="rep-root">
      <header className="rep-header">
        <Link href="/" className="rep-back">
          ← New scan
        </Link>
        <div className="rep-target">
          <span className="rep-label">Target</span>
          <a href={rec?.target_url || "#"} target="_blank" rel="noreferrer">
            {rec?.target_url || "…"}
          </a>
          <div className="rep-target-sub">
            {targetHost ? <code>{targetHost}</code> : null}
            {targetIp ? <code className="ip">{targetIp}</code> : null}
          </div>
        </div>
        <div className="rep-status">
          {rec ? <StatusBadge status={rec.status} /> : null}
          {rec ? (
            <span className="rep-elapsed">
              {Math.round(rec.elapsed_s)}s
            </span>
          ) : null}
        </div>
        <div className="rep-actions">
          {rec?.kasm_viewer_url ? (
            <a
              className="btn-ghost"
              href={rec.kasm_viewer_url}
              target="_blank"
              rel="noreferrer"
            >
              Open in new tab ↗
            </a>
          ) : null}
          {rec?.status === "analyzing" ? (
            <>
              <button className="btn-primary" onClick={onFinalize}>
                Finalize
              </button>
              <button className="btn-ghost-bad" onClick={onDestroy}>
                Cancel
              </button>
            </>
          ) : null}
        </div>
      </header>

      {loadErr ? <p className="rep-error">{loadErr}</p> : null}
      {rec?.error ? <p className="rep-error">Analysis error: {rec.error}</p> : null}

      <div className="rep-summary">
        <Stat label="Flows" value={stats.total} />
        <Stat label="Hosts" value={stats.hosts} />
        <Stat
          label="HTTPS"
          value={stats.total ? `${Math.round((stats.https * 100) / stats.total)}%` : "—"}
        />
        <Stat label="Errors" value={stats.errors} color={stats.errors ? "#f85149" : undefined} />
        <Stat label="Bytes" value={fmtBytes(stats.bytes)} />
        <Stat label="Kasm" value={rec?.kasm_id?.slice(0, 8) || "—"} mono />
      </div>

      <div className="rep-grid">
        <section className="rep-shot">
          <div className="rep-shot-head">
            <span>Browser</span>
            <div className="rep-view-toggle">
              <button
                className={view === "live" ? "active" : ""}
                onClick={() => setView("live")}
                disabled={!rec?.kasm_viewer_url}
              >
                Live
              </button>
              <button
                className={view === "snapshot" ? "active" : ""}
                onClick={() => setView("snapshot")}
                disabled={!rec?.has_screenshot}
              >
                Snapshot
              </button>
            </div>
          </div>
          <div className="rep-shot-body">
            {view === "live" && rec?.kasm_viewer_url ? (
              <iframe
                title="Kasm session"
                src={rec.kasm_viewer_url}
                allow="clipboard-read; clipboard-write; fullscreen; autoplay"
                {...({ credentialless: "" } as Record<string, string>)}
              />
            ) : view === "snapshot" && rec?.has_screenshot ? (
              <img
                key={shotV}
                src={`${screenshotUrl(sessionId)}?v=${shotV}`}
                alt="Browser snapshot"
              />
            ) : rec?.status === "analyzing" ? (
              <div className="rep-shot-skel">
                <div className="spinner" />
                <p>Provisioning Kasm Chrome…</p>
                <p className="muted">
                  Workspace will appear here as soon as Kasm reports it running.
                </p>
              </div>
            ) : rec?.status === "failed" ? (
              <div className="rep-shot-skel">
                <p className="muted">Analysis failed — see banner above.</p>
              </div>
            ) : (
              <div className="rep-shot-skel">
                <p className="muted">No browser available.</p>
              </div>
            )}
          </div>
          {view === "live" && rec?.kasm_viewer_url ? (
            <div className="rep-shot-foot">
              Iframe runs <code>credentialless</code> — no cookies sent, JWT-only
              auth (Chrome/Edge 110+). On older browsers, fall back to{" "}
              <a href={rec.kasm_viewer_url} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
              .
            </div>
          ) : null}
        </section>

        <section className="rep-panel">
          <nav className="rep-tabs">
            <button
              className={tab === "hosts" ? "active" : ""}
              onClick={() => setTab("hosts")}
            >
              Hosts ({stats.hosts})
            </button>
            <button
              className={tab === "flows" ? "active" : ""}
              onClick={() => setTab("flows")}
            >
              Flows ({stats.total})
            </button>
            <button
              className={tab === "detail" ? "active" : ""}
              onClick={() => setTab("detail")}
              disabled={!detail}
            >
              Flow detail
            </button>
            <input
              className="rep-filter"
              placeholder="filter host / path / IP / status"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </nav>

          {tab === "hosts" ? (
            <div className="rep-table-wrap">
              <table className="rep-table">
                <thead>
                  <tr>
                    <th>Host</th>
                    <th>Resolved IPs</th>
                    <th>Flows</th>
                    <th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {hosts.map((h) => (
                    <tr
                      key={h.host}
                      onClick={() => {
                        setFilter(h.host);
                        setTab("flows");
                      }}
                    >
                      <td className="trunc">
                        {h.host === targetHost ? (
                          <strong className="target-host">{h.host}</strong>
                        ) : (
                          h.host
                        )}
                      </td>
                      <td className="ip">
                        {Array.from(h.ips).join(", ") || "—"}
                      </td>
                      <td>{h.count}</td>
                      <td style={{ color: h.errors ? "#f85149" : "var(--muted)" }}>
                        {h.errors || "—"}
                      </td>
                    </tr>
                  ))}
                  {hosts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        {rec?.status === "analyzing"
                          ? "Capturing…"
                          : "No hosts contacted."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "flows" ? (
            <div className="rep-table-wrap">
              <table className="rep-table">
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
                        <span className={`rep-method ${r.scheme || ""}`}>
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
                        No flows yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "detail" ? (
            <div className="rep-detail">
              {detail ? (
                <>
                  <h3>
                    <span className={`rep-method ${detail.scheme || ""}`}>
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
                    <KV label="Cert subject" value={detail.server_cert?.subject ?? "—"} />
                    <KV label="Cert issuer" value={detail.server_cert?.issuer ?? "—"} />
                    <KV
                      label="Sizes"
                      value={`req ${fmtBytes(detail.req_len)} · resp ${fmtBytes(detail.resp_len)}`}
                    />
                  </div>
                  {detail.req_preview ? (
                    <>
                      <h4>Request body</h4>
                      <pre>{detail.req_preview}</pre>
                    </>
                  ) : null}
                  {detail.resp_preview ? (
                    <>
                      <h4>Response body</h4>
                      <pre>{detail.resp_preview}</pre>
                    </>
                  ) : null}
                </>
              ) : (
                <p className="muted">Select a flow.</p>
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
  mono,
}: {
  label: string;
  value: string | number;
  color?: string;
  mono?: boolean;
}) {
  return (
    <div className="rep-stat">
      <span className="rep-stat-label">{label}</span>
      <span
        className={`rep-stat-value${mono ? " mono" : ""}`}
        style={color ? { color } : undefined}
      >
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
