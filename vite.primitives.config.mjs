// vite.primitives.config.mjs
//
// Purpose: separate Vite build for React primitive browser tests — keeps
// public/v2/app/bundle.js byte-identical while primitives-harness.js ships tests.
//
// WHY THIS WRITES TO build/harness/ AND NOT public/v2/app/
// --------------------------------------------------------
// It used to write beside the production bundle, and vite.config.mjs sets
// `emptyOutDir: true` on that same directory. Every `npm run build` therefore
// DELETED primitives-harness.js and never put it back — measured 2026-08-26:
// the file vanished 2.06s into a 2.71s build and was absent from then on. A
// browser test navigating in that window failed with a Playwright
// `waitForSelector` timeout, which is indistinguishable from a broken harness
// scene. Four agents diagnosed it independently and two red runs were written
// off as flakes.
//
// The two builds now own disjoint trees, so the race is not narrowed, it is
// structurally impossible: neither build can name the other's files. That is
// why this is a separate directory rather than `emptyOutDir: false` plus a
// clean step (whose clean has the same race) or a plugin that saves and
// restores the artefact (which only shortens the window).
//
// It sits OUTSIDE public/ deliberately. scripts/build_static_snapshot.js copies
// public/ wholesale into dist/, so a test-only 718 KB bundle under public/
// would start shipping to the hosted static site; and scripts/
// generate_code_index.js walks public/v2, so a generated file there would be
// indexed as a source module with no Purpose: line. Neither happens here.
//
// tests/fixtures/ensurePrimitivesHarness.js builds this and mounts it at
// /v2/harness for the browser fixtures.

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
    outDir: path.resolve(__dirname, 'build/harness'),
    // Safe to empty now, and deliberate: this build is the sole writer of
    // build/harness, so cleaning it drops stale chunks without touching an
    // artefact anything else depends on. It was `false` only because the
    // directory used to be shared.
    emptyOutDir: true,
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
