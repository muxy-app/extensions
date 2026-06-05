import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        panel: resolve(__dirname, 'panel.html'),
      },
    },
  },
});

