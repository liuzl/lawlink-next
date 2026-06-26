import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Bind all interfaces so the dev SPA is reachable from other machines (e.g.
    // over the tailnet). Vite proxies /api to its OWN localhost API, so only this
    // dev server needs to be externally reachable. allowedHosts: true accepts the
    // tailnet hostname in the Host header (Vite blocks unknown hosts by default).
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
