import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxy so the browser only ever talks to one origin (avoids CORS entirely in dev).
// API_PROXY_TARGET lets this point at a non-default API port if needed.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
