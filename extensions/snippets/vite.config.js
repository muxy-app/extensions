import { defineConfig } from "vite";
import { resolve } from "node:path";
import { requireMuxyUi } from "./scripts/muxy-ui.mjs";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@muxy/ui": requireMuxyUi(),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Muxy's WebKit supports <link rel="modulepreload"> natively.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        panel: resolve(import.meta.dirname, "panel/index.html"),
      },
      output: {
        // Keep shared code (core logic, Muxy bridge, base styles, @muxy/ui) in its own chunk.
        manualChunks: (id) => (/\/src\/(lib|styles)\/|\/shared\/ui\//.test(id) ? "shared" : undefined),
      },
    },
  },
});
