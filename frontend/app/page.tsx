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
      setBusy(false);
    }
  }

  return (
    <main className="home-root">
      <div className="home-card">
        <div className="home-brand">
          <div className="home-logo">SOC</div>
          <div>
            <h1>URL Sandbox</h1>
            <p>Detonate a link inside an isolated Kasm Chrome with full TLS-decrypted network capture.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="home-form">
          <label>
            <span>Target URL</span>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
              autoFocus
              spellCheck={false}
            />
          </label>
          {err ? <p className="home-err">{err}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? "Provisioning Kasm…" : "Detonate"}
          </button>
        </form>

        <ul className="home-features">
          <li><strong>Isolated</strong> — Chrome runs in a Kasm container, never on your host</li>
          <li><strong>Decrypted</strong> — mitmproxy CA installed in the container's NSS DB</li>
          <li><strong>Live</strong> — flows, hosts, IPs, TLS metadata stream into the workspace</li>
        </ul>
      </div>
    </main>
  );
}
