import { defineConfig } from "vite";
import { resolve } from "node:path";

const target = process.env.NBLD_API_TARGET ?? "http://127.0.0.1:6363";
const root = process.cwd();

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, "index.html"),
        editor: resolve(root, "editor.html"),
      },
    },
  },
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
