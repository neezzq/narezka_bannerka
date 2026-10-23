/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

const API = process.env.VITE_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*.png", "icons/*.svg", "splash/*.png", "fonts/*.ttf", "fonts/fonts.json"],
      manifest: {
        id: "/",
        name: "Bannerka — нарезка роликов с баннерами",
        short_name: "Bannerka",
        description: "Нарезка роликов из YouTube, Twitch и TikTok с субтитрами и баннерной рекламой",
        lang: "ru",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#121214",
        background_color: "#121214",
        categories: ["photo", "productivity", "video"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ttf,json,webmanifest}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // previews, thumbnails, banners: immutable by id
            urlPattern: ({ url }) => url.pathname.startsWith("/api/media/") && !/\.(mp4|mov|webm)$/.test(url.pathname),
            handler: "CacheFirst",
            options: {
              cacheName: "bk-media",
              expiration: { maxEntries: 300, maxAgeSeconds: 24 * 3600 },
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: true,
    port: 5173,
    proxy: { "/api": { target: API, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { "/api": { target: API } } },
  build: { target: "es2021", sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
