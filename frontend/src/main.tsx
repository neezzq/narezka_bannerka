import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { toast } from "./components/ios";
import { t } from "./i18n";
import { applyTheme, useApp } from "./store/app";
import "./styles/index.css";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
