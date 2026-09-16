import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, "viewer/index.html"),
        popover: resolve(__dirname, "popover/index.html"),
        lookup: resolve(__dirname, "lookup/index.html"),
      },
    },
  },
});
