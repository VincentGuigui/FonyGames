/**
 * Copy `api/` into `dist/api/`, so the one SFTP sync ships it.
 * Docs: docs/deployment.md §5
 *
 * The deploy uploads the contents of `dist/` and nothing else. `api/` is source that
 * needs no compiling, but it still has to reach the host — and adding a second sync
 * step would mean two uploads that can disagree about which commit is live. Staging it
 * into the build output keeps "one build, one upload" true.
 *
 * ## What is deliberately left behind
 *
 * - **`tests/`** — the harness runs on a laptop and in CI. On the host it would be a
 *   directory of executable PHP with no reason to exist, and `run.php` would happily
 *   run from a browser.
 * - **`config.example.php`** — placeholders, but a file called `config.example.php`
 *   next to a real `config.php` is an invitation to guess the second name.
 *
 * `.htaccess` files ARE copied: `api/lib/.htaccess` is the thing that stops `lib/`
 * being served if the PHP handler is ever misconfigured, so losing it silently would
 * remove a layer nobody would notice was gone.
 *
 * Plain `node:fs`, no dependency. `--check` verifies the staging happened, for a test
 * that would otherwise only fail on the host.
 *
 * ## `dist-private/` — the second tree, for beside `/www` rather than inside it
 *
 * `hosts.json` and `db/` are not pages and were never meant to be reachable over
 * HTTP — they used to sit inside `dist/api/` and `dist/db/` protected only by an
 * `.htaccess` deny, which depends on Apache actually honouring it. The deploy now
 * uploads this second tree one level *above* `/www` instead, where nothing is served
 * from at all — no `.htaccess` to get wrong, because there is no web root there to
 * misconfigure. `App.php` looks for both in that location first (docs/deployment.md
 * §3.1).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// `process.cwd()`, not `import.meta.url`: npm scripts run from the repo root, and this
// file's own location moves if the script is ever bundled.
const ROOT = resolve(process.cwd());
const SRC = join(ROOT, 'api');
const OUT = join(ROOT, 'dist', 'api');
const PRIVATE_OUT = join(ROOT, 'dist-private');

/** `migrations/` and `init.sql` only — `migrate.php` is a CLI tool with no business here. */
const DB_SRC = join(ROOT, 'db');
const DB_OUT = join(PRIVATE_OUT, 'db');

/**
 * The deployed hostnames, staged for beside `/www`.
 *
 * `shared/hosts.json` is the single place they live (docs/realtime-server.md §6), and
 * `App::healthTargets()` needs them at REQUEST time on the host — so the file has to
 * travel rather than being baked into a bundle.
 */
const HOSTS_SRC = join(ROOT, 'shared', 'hosts.json');
const HOSTS_OUT = join(PRIVATE_OUT, 'hosts.json');

/** Left behind on purpose — see the header. */
const SKIP = new Set(['tests', 'config.example.php', 'config.php']);

const check = process.argv.includes('--check');

function fail(message) {
  console.error(`stage-api: ${message}`);
  process.exit(1);
}

if (!existsSync(SRC)) fail('api/ does not exist');
if (!existsSync(join(DB_SRC, 'migrations'))) fail('db/migrations/ does not exist');

/** The SQL the host needs, relative to db/. */
function dbFiles() {
  const migrations = readdirSync(join(DB_SRC, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => `migrations/${f}`);

  if (migrations.length === 0) fail('db/migrations/ has no .sql files');

  return ['init.sql', ...migrations];
}

/** Every file that should end up in dist/api, as a path relative to api/. */
function wanted(dir = '') {
  const out = [];
  for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (SKIP.has(rel)) continue;
    if (entry.isDirectory()) out.push(...wanted(rel));
    else out.push(rel);
  }
  return out;
}

const files = wanted();

if (files.length === 0) fail('nothing to stage — is api/ empty?');
if (!files.includes('index.php')) fail('api/index.php is missing, so there is no entry point');
if (!files.includes('lib/.htaccess')) {
  // Loud rather than silent: without it, a misconfigured PHP handler serves lib/ as
  // text, and config.php is the file next door.
  fail('api/lib/.htaccess is missing — that is the guard on lib/, not an optional extra');
}

const sql = dbFiles();

if (check) {
  if (!existsSync(OUT)) fail('dist/api/ does not exist — run the build');
  const missing = files.filter((f) => !existsSync(join(OUT, f)));
  if (missing.length > 0) fail(`dist/api/ is stale, missing: ${missing.join(', ')}`);
  for (const skipped of ['tests', 'config.example.php']) {
    if (existsSync(join(OUT, skipped))) fail(`dist/api/${skipped} should not have been staged`);
  }

  if (!existsSync(HOSTS_OUT)) fail('dist-private/hosts.json is missing — App.php would have no health targets');
  const missingSql = sql.filter((f) => !existsSync(join(DB_OUT, f)));
  if (missingSql.length > 0) fail(`dist-private/db/ is stale, missing: ${missingSql.join(', ')}`);
  if (existsSync(join(DB_OUT, 'migrate.php'))) fail('db/migrate.php is a CLI tool and must not ship');

  console.log(`stage-api: dist/api/ has all ${files.length} files and dist-private/db/ all ${sql.length}`);
  process.exit(0);
}

// Fresh every time. Without the wipe, a file deleted from api/ would live on in dist/
// forever — and the SFTP sync deletes nothing, so it would live on the host too.
rmSync(OUT, { recursive: true, force: true });

for (const rel of files) {
  const to = join(OUT, rel);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(join(SRC, rel), to);
}

rmSync(PRIVATE_OUT, { recursive: true, force: true });

if (!existsSync(HOSTS_SRC)) fail('shared/hosts.json is missing');
mkdirSync(PRIVATE_OUT, { recursive: true });
cpSync(HOSTS_SRC, HOSTS_OUT);

for (const rel of sql) {
  const to = join(DB_OUT, rel);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(join(DB_SRC, rel), to);
}

const bytes = files.reduce((n, f) => n + statSync(join(SRC, f)).size, 0);
console.log(
  `stage-api: ${files.length} files, ${(bytes / 1024).toFixed(1)} KB → dist/api/` +
    ` · ${sql.length} sql → dist-private/db/`,
);
