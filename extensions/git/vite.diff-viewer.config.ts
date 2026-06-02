import { defineConfig } from "vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const WORKER_SRC = resolve(
  __dirname,
  "node_modules/@pierre/diffs/dist/worker/worker-portable.js",
);

export default defineConfig({
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
    {
      name: "copy-diffs-worker",
      writeBundle() {
        copyFileSync(WORKER_SRC, resolve(__dirname, "dist/diffs-worker.js"));
      },
    },
  ],
});
