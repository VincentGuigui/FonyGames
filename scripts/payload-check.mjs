import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));
const entries = Object.values(manifest);
const byRef = new Map(entries.map((entry) => [entry.file, entry]));

function entryFor(src) {
  const entry = Object.values(manifest).find((candidate) => candidate.src === src);
  if (!entry) throw new Error(`payload: entry ${src} is missing`);
  return entry;
}

function closure(entry) {
  const seen = new Set();
  const queue = [...(entry.imports ?? [])];
  while (queue.length > 0) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);
    const child = byRef.get(ref);
    if (child) queue.push(...(child.imports ?? []));
  }
  return [...seen].map((ref) => byRef.get(ref)).filter(Boolean);
}

function hasNamedChunk(entry, name) {
  return closure(entry).some((child) => child.name === name);
}

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exitCode = 1;
}

const hub = entryFor('index.html');
if (hasNamedChunk(hub, 'lobby') || hasNamedChunk(hub, 'protocol')) {
  fail('hub statically imports room/game runtime code');
}

const routes = Object.values(manifest).filter((entry) => entry.isEntry && entry.src?.endsWith('/index.html'));
const motionRoutes = new Set(['pass-the-bomb', 'shake-rush', 'steady-hand']);
const orientationRoutes = new Set(['ghost-hunt', 'neon-fall']);

for (const route of routes) {
  const slug = route.src.split('/')[0];
  if (!motionRoutes.has(slug) && hasNamedChunk(route, 'motion')) fail(`${slug} imports motion`);
  if (!orientationRoutes.has(slug) && hasNamedChunk(route, 'orientation')) fail(`${slug} imports orientation`);
}

const tone = entries.find((entry) => entry.src?.includes('node_modules/tone'));
if (!tone?.isDynamicEntry) fail('Tone audio is not a dynamic entry');

const photosphere = entries.find((entry) => entry.src?.includes('photosphere.jpg?url'));
if (!photosphere?.isDynamicEntry) fail('Ghost Hunt photosphere is not a dynamic entry');

if (process.exitCode) process.exit();
console.log(`payload guard passed (${routes.length} game/admin entries)`);
