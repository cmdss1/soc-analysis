/**
 * Browser: same-origin `/soc-api` via Next rewrites → avoids CORS / flaky SSE to :8000.
 * Server (SSR): env or direct backend URL.
 */
export function apiBase(): string {
  if (typeof window !== "undefined") {
    const origin = window.location.origin.replace(/\/$/, "");
    return `${origin}/soc-api`;
  }
  const fromEnv = process.env.NEXT_PUBLIC_API_BASE;
  if (fromEnv?.trim()) {
    return fromEnv.replace(/\/$/, "");
  }
  return "http://127.0.0.1:8000";
}

export async function createSandboxSession(targetUrl: string) {
  const res = await fetch(`${apiBase()}/api/v1/sandbox/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl }),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = (j as { detail?: string }).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<{
    session_id: string;
    kasm_viewer_url: string | null;
    target_url: string;
    kasm_id?: string | null;
  }>;
}

export async function fetchSession(sessionId: string) {
  const res = await fetch(`${apiBase()}/api/v1/sandbox/sessions/${sessionId}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error("Session not found");
  }
  return res.json() as Promise<{
    session_id: string;
    target_url: string;
    kasm_viewer_url: string | null;
    kasm_id: string | null;
  }>;
}

export function eventsUrl(sessionId: string) {
  return `${apiBase()}/api/v1/sandbox/sessions/${sessionId}/events`;
}

export async function destroySandboxSession(sessionId: string) {
  await fetch(`${apiBase()}/api/v1/sandbox/sessions/${sessionId}/destroy`, {
    method: "POST",
  });
}
