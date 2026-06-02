import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "copy-panel-html",
      writeBundle() {
        mkdirSync(resolve(__dirname, "dist/panel"), { recursive: true });
        copyFileSync(
          resolve(__dirname, "panel/index.html"),
          resolve(__dirname, "dist/panel/index.html"),
        );
      },
    },
  ],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(__dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "GitPanel",
      fileName: () => "panel.js",
    },
    rollupOptions: {
      output: { assetFileNames: "panel.[ext]" },
    },
  },
});
