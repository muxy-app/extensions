import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        panel: resolve(import.meta.dirname, 'panel.html'),
      },
    },
  },
});
