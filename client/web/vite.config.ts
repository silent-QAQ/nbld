import { defineConfig } from "vite";

const target = process.env.NBLD_API_TARGET ?? "http://127.0.0.1:6363";

export default defineConfig({
  server: {
    proxy: {
      "/api": target,
      "/debug": target,
      "/healthz": target,
      "/ws": {
        target,
        ws: true,
      },
    },
  },
});
