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
    // The SSR step needs to know each art file's CONTENT-HASHED url, so the markup it
    // renders is byte-identical to what the client renders and hydration is exact
    // (docs/specs/seo.md §4). The manifest is the only place Vite publishes that
    // mapping. Emitted to dist/.vite/manifest.json and not deployed — it is a build
    // artefact, and `scripts/ssr.mjs` deletes it once it has read it.
    manifest: true,
    // Multi-page, one real index.html per route. Static hosting serves
    // /tap-duel/ straight from disk — no SPA rewrite rule needed, which we
    // could not rely on having on the shared host.
    // Rollup resolves these from the working directory (the repo root), not
    // from Vite's `root`. Written this way to avoid pulling in @types/node
    // just to get __dirname for the entry points.
    rollupOptions: {
      input: {
        hub: 'www/index.html',
        'tap-duel': 'www/tap-duel/index.html',
        spill: 'www/spill/index.html',
        'goat-siege': 'www/goat-siege/index.html',
        'sling-puck': 'www/sling-puck/index.html',
        'cat-and-mouse': 'www/cat-and-mouse/index.html',
        'pass-the-bomb': 'www/pass-the-bomb/index.html',
        'steady-hand': 'www/steady-hand/index.html',
        'grid-attack': 'www/grid-attack/index.html',
        'squash-mosquitoes': 'www/squash-mosquitoes/index.html',
        'shake-rush': 'www/shake-rush/index.html',
        'ghost-hunt': 'www/ghost-hunt/index.html',
        'neon-fall': 'www/neon-fall/index.html',
        // The admin centre. Built to a PLACEHOLDER directory name and renamed to the
        // ADMIN_PATH secret by the deploy — this repository is public, so the real
        // path cannot be committed (docs/deployment.md §3.4).
        ops: 'www/ops-placeholder/index.html',
      },
      output: {
        // A card imported by BOTH the hub and its own game page would otherwise be
        // split into a ~700-byte shared chunk — and the hub imports all thirteen, so
        // that was four extra requests on the one page with a first-load target.
        // Absorbing chunks this small into their importers duplicates a few hundred
        // bytes and puts the hub back to one request.
        experimentalMinChunkSize: 4000,
      },
    },
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
