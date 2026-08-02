import { defineConfig } from 'vite';

// Source lives in www/ (see docs/architecture.md §3); the built site goes to
// dist/, which is what the deploy workflow uploads to the host.
export default defineConfig({
  root: 'www',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
    // Payload budget in docs/architecture.md §4 is 150 KB gzipped for the hub.
    // Warn well before we get there.
    chunkSizeWarningLimit: 200,
  },
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  server: {
    host: true, // reachable from a phone on the LAN
  },
});
