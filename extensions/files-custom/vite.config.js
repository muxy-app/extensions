import { defineConfig } from "vite";
import { resolve } from "node:path";

// The panel and the editor tab are separate pages (each a separate webview),
// so they get separate entry chunks: the panel never loads CodeMirror.
const ENTRIES = {
  files: resolve(__dirname, "panel/index.html"),
  editor: resolve(__dirname, "panel/editor.html"),
};

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "safari16",
    // pdf.js and mermaid are large but load only when such a file is opened.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      // `ENTRY=editor vite build` builds one page, for quicker iteration.
      input: process.env.ENTRY ? { [process.env.ENTRY]: ENTRIES[process.env.ENTRY] } : ENTRIES,
    },
  },
});
