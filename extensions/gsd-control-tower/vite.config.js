import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Single source of truth for the version: package.json. Injected as
// __EXTENSION_VERSION__ so src/core/types.js never drifts from the manifest.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  base: "./",
  define: {
    __EXTENSION_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel/index.html"),
        // Emitted under a stable, un-hashed name so the manifest can point at it.
        background: resolve(__dirname, "src/background/main.js"),
      },
      output: {
        entryFileNames(chunk) {
          return chunk.name === "background"
            ? "background.js"
            : "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
