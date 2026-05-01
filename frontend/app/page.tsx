"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSandboxSession } from "@/lib/api";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
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
      setErr(ex instanceof Error ? ex.message : "Submit failed");
      setBusy(false);
    }
  }

  return (
    <main className="home-root">
      <div className="home-card">
        <div className="home-brand">
          <div className="home-logo">SOC</div>
          <div>
            <h1>URL Detonator</h1>
            <p>
              Submit a suspicious URL. We open it inside an isolated Kasm Chrome,
              decrypt all TLS traffic via mitmproxy, then snapshot the page.
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="home-form">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://suspicious.example/path"
            autoFocus
            spellCheck={false}
            inputMode="url"
          />
          <button type="submit" disabled={busy || !url.trim()}>
            {busy ? "Detonating…" : "Submit"}
          </button>
        </form>
        {err ? <p className="home-err">{err}</p> : null}

        <ul className="home-features">
          <li>
            <strong>Isolated</strong> — Chrome runs in a Kasm container, never on
            your host
          </li>
          <li>
            <strong>Decrypted</strong> — mitmproxy CA installed in Chrome's NSS
            DB, full HTTPS visibility
          </li>
          <li>
            <strong>Reported</strong> — screenshot, hosts, IPs, TLS metadata,
            response bodies
          </li>
        </ul>
      </div>
    </main>
  );
}
