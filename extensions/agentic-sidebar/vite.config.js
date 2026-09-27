import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, "app/index.html"),
      },
    },
  },
});
