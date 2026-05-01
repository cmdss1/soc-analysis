/**
 * Browser: same-origin `/soc-api` via Next rewrites.
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

export type SandboxStatus = "pending" | "analyzing" | "completed" | "failed";

export type HostSummary = {
  host: string;
  ips: string[];
  count: number;
  errors: number;
};

export type SandboxRecord = {
  session_id: string;
  target_url: string;
  kasm_id: string | null;
  kasm_viewer_url: string | null;
  status: SandboxStatus;
  error: string | null;
  created_at: number;
  completed_at: number | null;
  elapsed_s: number;
  has_screenshot: boolean;
  summary: {
    flow_count: number;
    host_count: number;
    hosts: HostSummary[];
  };
};

export async function createSandboxSession(targetUrl: string): Promise<SandboxRecord> {
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
  return res.json();
}

export async function fetchSession(sessionId: string): Promise<SandboxRecord> {
  const res = await fetch(`${apiBase()}/api/v1/sandbox/sessions/${sessionId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Session not found");
  return res.json();
}

export function eventsUrl(sessionId: string): string {
  return `${apiBase()}/api/v1/sandbox/sessions/${sessionId}/events`;
}

export function screenshotUrl(sessionId: string): string {
  return `${apiBase()}/api/v1/sandbox/sessions/${sessionId}/screenshot`;
}

export async function destroySandboxSession(sessionId: string): Promise<void> {
  await fetch(`${apiBase()}/api/v1/sandbox/sessions/${sessionId}/destroy`, {
    method: "POST",
  });
}
