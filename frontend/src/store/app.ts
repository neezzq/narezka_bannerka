import { create } from "zustand";
import { api } from "@/lib/api";
import type { AppConfig } from "@/lib/types";

export type Theme = "dark" | "light" | "system";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem("bk-theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* private mode */
  }
  return "dark";
}

export function applyTheme(theme: Theme) {
  const light = theme === "light" || (theme === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#F2F2F7" : "#121214");
}

interface AppState {
  config: AppConfig;
  theme: Theme;
  online: boolean;
  loadConfig: () => Promise<void>;
  setTheme: (t: Theme) => void;
  setOnline: (v: boolean) => void;
}

export const useApp = create<AppState>((set) => ({
  config: { maxClipSeconds: 180, maxBannerMb: 50, maxUploadMb: 1024, languages: [] },
  theme: readTheme(),
  online: navigator.onLine,
  loadConfig: async () => {
    try {
      set({ config: await api.config() });
    } catch {
      /* keep defaults */
    }
  },
  setTheme: (theme) => {
    try {
      localStorage.setItem("bk-theme", theme);
    } catch {
      /* ignore */
    }
    applyTheme(theme);
    set({ theme });
  },
  setOnline: (online) => set({ online }),
}));
