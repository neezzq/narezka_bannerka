// Client error reporting: errors land in the API log (`client error` lines),
// which is the only way to see what broke on a user's phone.
const sent = new Set<string>();
const MAX_REPORTS = 20;

export function reportError(err: unknown, context = "") {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(context ? `[${context}]` : "", e);
  const key = `${context}|${e.message}`;
  if (sent.has(key) || sent.size >= MAX_REPORTS) return;
  sent.add(key);
  const body = JSON.stringify({
    message: e.message.slice(0, 500),
    stack: (e.stack || "").slice(0, 2000),
    context: context.slice(0, 100),
    url: location.pathname,
  });
  try {
    if (!navigator.sendBeacon?.("/api/client-log", new Blob([body], { type: "application/json" }))) {
      fetch("/api/client-log", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(
        () => undefined,
      );
    }
  } catch {
    /* reporting must never throw */
  }
}

export function installErrorReporting() {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "promise"));
}
