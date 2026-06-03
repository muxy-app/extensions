import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WORKER_SRC = resolve(
  __dirname,
  "node_modules/@pierre/diffs/dist/worker/worker-portable.js",
);

export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/diff-viewer/diff-viewer.ts"),
      formats: ["iife"],
      name: "DiffViewer",
      fileName: () => "diff-viewer.js",
    },
    rollupOptions: {
      output: { assetFileNames: "diff-viewer.[ext]" },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-diffs-worker",
      writeBundle() {
        copyFileSync(WORKER_SRC, resolve(__dirname, "dist/diffs-worker.js"));
        mkdirSync(resolve(__dirname, "dist/panel"), { recursive: true });
        copyFileSync(
          resolve(__dirname, "panel/diff-viewer.html"),
          resolve(__dirname, "dist/panel/diff-viewer.html"),
        );
      },
    },
  ],
});
