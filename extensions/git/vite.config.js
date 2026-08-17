import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [tailwindcss()],
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
    rollupOptions: {
      input: {
        scm: resolve(__dirname, "panel/index.html"),
        "diff-viewer": resolve(__dirname, "panel/diff-viewer.html"),
        commit: resolve(__dirname, "modal/commit.html"),
        "create-pr": resolve(__dirname, "modal/create-pr.html"),
        "pr-checkout": resolve(__dirname, "modal/pr-checkout.html"),
      },
    },
  },
});
