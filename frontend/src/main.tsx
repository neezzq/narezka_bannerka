import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { toast } from "./components/ios";
import { t } from "./i18n";
import { installErrorReporting } from "./lib/report";
import { applyTheme, useApp } from "./store/app";
import "./styles/index.css";

installErrorReporting();
applyTheme(useApp.getState().theme);

// Block page pinch-zoom (iOS ignores user-scalable=no); double-tap zoom is
// disabled with `touch-action: manipulation`. The editor has its own gestures.
document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast({
          title: t("app.updateReady"),
          tone: "info",
          action: { label: t("app.reload"), onClick: () => update(true) },
          duration: 0,
        });
      },
    });
  });
}

if (import.meta.env.DEV) {
  // test hook for automated UI checks (scripts/parity): not included in production builds
  Promise.all([import("./editor/playback"), import("./store/editor")]).then(([pb, ed]) => {
    (window as any).__bk = { playback: pb.playback, usePlayer: pb.usePlayer, useEditor: ed.useEditor };
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
