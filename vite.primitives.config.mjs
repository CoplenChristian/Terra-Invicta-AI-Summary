// vite.primitives.config.mjs
//
// Purpose: separate Vite build for React primitive browser tests — keeps
// public/v2/app/bundle.js byte-identical while primitives-harness.js ships tests.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  mode: 'production',
  plugins: [react()],
  publicDir: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': {},
  },
  build: {
    outDir: path.resolve(__dirname, 'public/v2/app'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/v2/primitivesHarness.jsx'),
      name: 'MissionControlPrimitivesHarness',
      formats: ['es'],
      fileName: () => 'primitives-harness.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'primitives-harness.js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
