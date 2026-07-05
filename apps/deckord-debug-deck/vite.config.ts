import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs so the built UI works both from an http origin (dev/preview)
  // AND from a file:// origin when embedded in the Electron shell (loadFile). With
  // the default base '/', the emitted index.html references /assets/* which 404s
  // under file:// and renders a blank window in the packaged app.
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
