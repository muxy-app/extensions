// Production build of the dev harness pages, for benchmarking real bundles.
// See dev/README.md. `BENCH_ENTRY=panel|editor` builds one page;
// `BENCH_OUT=<dir>` overrides the output folder (default: bench-dist).
import { defineConfig, mergeConfig } from "vite";
import { resolve } from "node:path";
import base from "../vite.config.js";

const root = resolve(__dirname, "..");
const pages = {
  panel: resolve(root, "dev/panel.html"),
  editor: resolve(root, "dev/editor.html"),
};
const only = process.env.BENCH_ENTRY;

const config = mergeConfig(
  base,
  defineConfig({
    root,
    logLevel: "warn",
    build: {
      outDir: resolve(root, process.env.BENCH_OUT ?? "bench-dist"),
      emptyOutDir: true,
    },
  }),
);
// Replace (not merge with) the app's entries.
config.build.rollupOptions.input = only ? { [only]: pages[only] } : pages;

export default config;
