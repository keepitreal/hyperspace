import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The backtest API (pnpm server) runs on :8787; proxy /api so the browser can
// use same-origin relative URLs in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
