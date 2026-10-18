import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      includeAssets: ["favicon.svg", "manifest.json", "icons/*.png"],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json,woff,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        // Mapbox GL hace que el bundle principal pase de 2 MiB (límite por defecto).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],

  // Redirigir las consultas a la API del backend
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});