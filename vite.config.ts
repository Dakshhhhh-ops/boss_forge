import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  root: 'web',
  base: mode === 'judges' ? '/boss_forge/' : '/',
  server: { host: '127.0.0.1' },
  build: {
    outDir: mode === 'judges' ? '../dist/pages' : '../dist/web',
    chunkSizeWarningLimit: 650,
    emptyOutDir: true,
    rollupOptions: {
      input: mode === 'judges' ? {
        play: fileURLToPath(new URL('./web/play/index.html', import.meta.url)),
      } : {
        index: fileURLToPath(new URL('./web/index.html', import.meta.url)),
        play: fileURLToPath(new URL('./web/play/index.html', import.meta.url)),
        overlay: fileURLToPath(new URL('./web/overlay/index.html', import.meta.url)),
        forge: fileURLToPath(new URL('./web/forge/index.html', import.meta.url)),
        setup: fileURLToPath(new URL('./web/setup/index.html', import.meta.url)),
      },
    },
  },
}));
