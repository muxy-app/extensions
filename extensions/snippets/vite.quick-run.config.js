// Builds the quick-run command script (src/quick-run) into dist/quick-run.js.
// Muxy runs runScript files as plain scripts, so it is a single IIFE bundle.
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/quick-run/main.js"),
      formats: ["iife"],
      name: "SnippetsQuickRun",
      fileName: () => "quick-run.js",
    },
  },
});
