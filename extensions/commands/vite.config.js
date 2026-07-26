import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popover: resolve(__dirname, 'popover/index.html'),
        tab: resolve(__dirname, 'tab/index.html'),
      },
    },
  },
});
