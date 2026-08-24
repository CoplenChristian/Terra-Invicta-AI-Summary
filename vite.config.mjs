// vite.config.mjs
//
// Purpose: Vite build and dev configuration for React + MUI v2 dashboard.
//
// NOTE: Standalone port fallback (no server/config.js import) so clean checkouts
// and CI environments without config.json never fail build resolution.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const backendPort = Number(process.env.PORT || 3000);
const backendHost = process.env.HOST || '127.0.0.1';

export default defineConfig({
  mode: 'production',
  plugins: [react()],
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': {}
  },
  // Source entry point for React app
  build: {
    outDir: path.resolve(__dirname, 'public/v2/app'),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, 'src/v2/main.jsx'),
      name: 'MissionControlReact',
      formats: ['es'],
      fileName: () => 'bundle.js'
    },
    rollupOptions: {
      output: {
        entryFileNames: 'bundle.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true
      },
      '/v2/data': {
        target: `http://${backendHost}:${backendPort}`,
        changeOrigin: true
      }
    }
  }
});
