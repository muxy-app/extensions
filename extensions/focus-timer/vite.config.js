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
    minify: false,
    rollupOptions: {
      input: {
        popover: resolve(__dirname, "popover/index.html"),
        report: resolve(__dirname, "report/index.html"),
      },
    },
  },
});
