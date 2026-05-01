"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSandboxSession } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("https://example.com");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const out = await createSandboxSession(url.trim());
      router.push(`/session/${out.session_id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Launch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "48px 24px",
      }}
    >
      <h1 style={{ fontWeight: 600, fontSize: "1.75rem", marginBottom: 8 }}>
        SOC Kasm Sandbox
      </h1>
      <p style={{ color: "var(--muted)", marginBottom: 28, lineHeight: 1.5 }}>
        Paste a URL to spawn an isolated Kasm Chrome session routed through
        mitmproxy. Network and HTTP visibility streams beside the live desktop.
      </p>
      <form
        onSubmit={onSubmit}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: 20,
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Target URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "#0d1117",
              color: "var(--text)",
            }}
          />
        </label>
        {err ? (
          <p style={{ color: "#f85149", margin: 0, fontSize: 14 }}>{err}</p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "12px 16px",
            borderRadius: 6,
            border: "none",
            background: busy ? "#238636aa" : "#238636",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          {busy ? "Starting session…" : "Launch sandbox"}
        </button>
      </form>
      <p style={{ marginTop: 24, fontSize: 12, color: "var(--muted)" }}>
        Requires API at{" "}
        <code>{process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000"}</code>
        {" "}and a reachable{" "}
        <code>PUBLIC_API_BASE</code> from Kasm workspaces for MITM ingest.
      </p>
    </main>
  );
}
