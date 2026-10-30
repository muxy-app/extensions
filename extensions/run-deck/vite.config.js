import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    target: 'safari17',
    minify: true,
    rollupOptions: { input: resolve(import.meta.dirname, 'panel/index.html') },
  },
});
