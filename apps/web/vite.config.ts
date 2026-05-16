import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  base: '/dashboard/',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api/dashboard': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
