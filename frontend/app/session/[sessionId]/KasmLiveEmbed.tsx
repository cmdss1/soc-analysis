"use client";

import { useEffect, useRef } from "react";

/** Gecko / Firefox (incl. Floorp) does not implement credentialless iframes → Kasm cookies override JWT. */
export function kasmEmbedSupportsCredentialless(): boolean {
  if (typeof HTMLIFrameElement === "undefined") return false;
  return "credentialless" in HTMLIFrameElement.prototype;
}

/**
 * Chromium: navigations must NOT start until `credentialless` is true — otherwise the first
 * load sends admin cookies and Kasm shows the dashboard + «Uautorisert tilgang til økt».
 * Do not put `src` on the iframe in JSX; assign it only after enabling credentialless (MDN pattern).
 */
export default function KasmLiveEmbed({ src }: { src: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !src || !kasmEmbedSupportsCredentialless()) return;

    el.setAttribute("credentialless", "");
    try {
      (el as HTMLIFrameElement & { credentialless?: boolean }).credentialless = true;
    } catch {
      /* ignore */
    }
    el.src = src;

    return () => {
      el.src = "about:blank";
      el.removeAttribute("credentialless");
      try {
        (el as HTMLIFrameElement & { credentialless?: boolean }).credentialless = false;
      } catch {
        /* ignore */
      }
    };
  }, [src]);

  return (
    <iframe
      ref={ref}
      title="Kasm session"
      allow="clipboard-read; clipboard-write; fullscreen; autoplay"
    />
  );
}
