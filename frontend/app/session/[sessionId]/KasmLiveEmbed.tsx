"use client";

import { useEffect, useRef } from "react";

/** Gecko / Firefox (incl. Floorp) does not implement credentialless iframes → Kasm cookies override JWT. */
export function kasmEmbedSupportsCredentialless(): boolean {
  if (typeof HTMLIFrameElement === "undefined") return false;
  return "credentialless" in HTMLIFrameElement.prototype;
}

/**
 * Sets DOM credentialless so third-party Kasm cookies are not sent (Chrome/Edge 110+).
 * React may not forward unknown iframe props reliably.
 */
export default function KasmLiveEmbed({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !kasmEmbedSupportsCredentialless()) return;
    el.setAttribute("credentialless", "");
    try {
      (el as HTMLIFrameElement & { credentialless?: boolean }).credentialless = true;
    } catch {
      /* ignore */
    }
  }, [src]);

  return (
    <iframe
      ref={ref}
      title="Kasm session"
      src={src}
      allow="clipboard-read; clipboard-write; fullscreen; autoplay"
    />
  );
}
