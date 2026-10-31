import { defineConfig } from "vite";
import { resolve } from "node:path";

const ENTRIES = {
  scm: resolve(__dirname, "panel/index.html"),
  "diff-viewer": resolve(__dirname, "panel/diff-viewer.html"),
  "create-pr": resolve(__dirname, "modal/create-pr.html"),
  "pr-browser": resolve(__dirname, "modal/pr-browser.html"),
};

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari16",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: process.env.ENTRY ? { [process.env.ENTRY]: ENTRIES[process.env.ENTRY] } : ENTRIES,
    },
  },
});
