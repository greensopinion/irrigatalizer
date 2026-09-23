/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind all interfaces (not just localhost) so the dev server is reachable
    // once the container port is forwarded to the host. `strictPort` fails fast
    // rather than silently moving to another port that isn't forwarded.
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // The SPA calls same-origin `/api/*`; Vite proxies those to the backend
      // inside the container, so only the Vite port needs to be forwarded.
      "/api": "http://localhost:9000",
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
