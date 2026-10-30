import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@muxy/ui": resolve(__dirname, "../../shared/ui"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        mail: resolve(__dirname, "panel/index.html"),
      },
    },
  },
});
