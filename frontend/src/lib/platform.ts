import type { Platform } from "./types";

/** Light client-side detection for the platform icon; the server does the real validation. */
export function detectPlatform(text: string): Exclude<Platform, "upload"> | null {
  const m = /https?:\/\/[^\s]+|(?:www\.|m\.)?[a-z.]*(?:youtube\.com|youtu\.be|twitch\.tv|tiktok\.com)\/[^\s]*/i.exec(text);
  if (!m) return null;
  let url: URL;
  try {
    url = new URL(m[0].startsWith("http") ? m[0] : `https://${m[0]}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return "youtube";
  if (/(^|\.)twitch\.tv$/.test(host)) return "twitch";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  return null;
}

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as any).standalone === true;

export const isSafari = () => /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let probe: HTMLDivElement | null = null;
/** Measured safe-area insets in px (env() cannot be read from JS directly). */
export function safeAreaInsets(): { top: number; bottom: number } {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}
