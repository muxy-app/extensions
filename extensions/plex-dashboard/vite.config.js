import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function emitExtensionManifest() {
  return {
    name: "emit-extension-manifest",
    apply: "build",
    closeBundle() {
      const src = readFileSync(resolve(__dirname, "package.json"));
      writeFileSync(resolve(__dirname, "dist/package.json"), src);
    },
  };
}

export default defineConfig({
  root: ".",
  base: "./",
  publicDir: "public",
  plugins: [emitExtensionManifest()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      input: { panel: resolve(__dirname, "panel.html") },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
