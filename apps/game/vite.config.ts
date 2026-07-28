import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { soundtrack } from "./vite-plugin-soundtrack";

/**
 * Game build (PRD §17.1, §27).
 *
 * Served under /play by the gateway, so `base` must match or every asset URL
 * breaks behind the proxy.
 */
export default defineConfig({
  base: "/play/",
  plugins: [
    soundtrack(),
    preact(),
    VitePWA({
      registerType: "prompt", // never force an update mid-mission (PRD §27.4)
      injectRegister: null,
      manifest: {
        name: "NIGHTCELL 7: FALSE DAWN",
        short_name: "NIGHTCELL 7",
        description: "Two operatives. Two countries. One manufactured war.",
        theme_color: "#07090c",
        background_color: "#07090c",
        display: "standalone",
        start_url: "/play/",
        scope: "/play/",
        icons: [
          { src: "/play/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/play/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // Large packs are downloaded on demand by the content manager, not
        // precached, so an install does not pull a gigabyte unasked.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Authenticated APIs, tickets and matchmaking are NEVER cached
            // (PRD §27.2, CLAUDE.md).
            urlPattern: /^https?:\/\/[^/]+\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /\.(?:ktx2|glb|webp|webm|mp3|bin)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "nc7-content",
              expiration: { maxEntries: 2000 },
            },
          },
        ],
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: "hidden", // source maps stay private (PRD §33.1)
    rollupOptions: {
      output: {
        manualChunks: {
          babylon: ["@babylonjs/core"],
          netcode: ["colyseus.js"],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
});
