/**
 * Inject the Cloudflare Web Analytics beacon into the built pages.
 * Spec: docs/specs/analytics.md §2
 *
 * ## Why this is a build step and not a tag in `www/**\/index.html`
 *
 * The site tag differs between dev and prod, and the page HTML is committed — so a tag
 * written into the source would be one environment's, shipped to both, and every dev
 * pageview would land in prod's dashboard. The deploy already knows which environment
 * it is (`FONY_ENV`, from the branch name), so the token is chosen here, once, against
 * `shared/hosts.json`.
 *
 * ## Why the token is committed rather than a secret
 *
 * It ships in the HTML of every page — it *identifies* a site to Cloudflare, it
 * authorises nothing. A GitHub secret for a string that any visitor can read in view-
 * source would be security theatre, and it would mean one more value a fresh host has
 * to be given before analytics works. `shared/hosts.json` is already the one place
 * per-environment public values live.
 *
 * ## No environment, no beacon
 *
 * A plain `npm run build` on a laptop sets no `FONY_ENV`, so nothing is injected and a
 * local build never reports pageviews to anybody. That is the safe default and the
 * reason this reads an env var rather than defaulting to prod.
 *
 * Runs AFTER `build:ssr`, which is what moves `dist/index.html` to `_hub/page.html`
 * (docs/specs/seo.md §4) — injecting before it would write into a file that is about to
 * be renamed, and the hub would come out untracked.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIST = join(ROOT, 'dist');
const HOSTS = join(ROOT, 'shared', 'hosts.json');

/**
 * The admin centre is not a page anybody is measuring.
 *
 * It is the operator's own screen, it already carries `X-Robots-Tag: noindex`
 * (`api/htaccess-admin`), and beaconing it would put the secret `ADMIN_PATH` in a
 * Cloudflare dashboard as a page path — which is exactly the one string that is meant
 * not to be written down anywhere public.
 */
const SKIP = new Set(['ops-placeholder']);

/** The marker that says this file has already been done. Keeps a re-run idempotent. */
const SENTINEL = 'static.cloudflareinsights.com';

const env = process.env.FONY_ENV ?? '';

if (env === '') {
  console.log('beacon: no FONY_ENV, so no analytics beacon — local build.');
  process.exit(0);
}

const hosts = JSON.parse(readFileSync(HOSTS, 'utf8'));
const environment = hosts.environments?.[env];

if (!environment) {
  console.error(`beacon: FONY_ENV="${env}" is not in shared/hosts.json`);
  process.exit(1);
}

const token = environment.webAnalyticsToken ?? '';

if (token === '') {
  console.error(`beacon: no webAnalyticsToken for "${env}" in shared/hosts.json`);
  process.exit(1);
}

/*
 * `type="module"` and `defer`-by-default, so it never blocks the first paint of a game
 * that is about to ask for a sensor. Copied verbatim from the snippet Cloudflare hands
 * out, token aside: a hand-rewritten beacon is a thing that breaks silently the next
 * time they change it.
 */
const snippet =
  '<!-- Cloudflare Web Analytics -->' +
  `<script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "${token}"}'></script>` +
  '<!-- End Cloudflare Web Analytics -->';

/** Every built page: the game pages, plus the hub's template that `index.php` prints. */
function pages() {
  const found = [join(DIST, '_hub', 'page.html')];

  for (const entry of readdirSync(DIST)) {
    if (SKIP.has(entry)) continue;
    const candidate = join(DIST, entry, 'index.html');
    if (statSync(join(DIST, entry), { throwIfNoEntry: false })?.isDirectory() !== true) continue;
    try {
      if (statSync(candidate).isFile()) found.push(candidate);
    } catch {
      // A directory of assets rather than a route. Not every folder is a page.
    }
  }

  return found;
}

let done = 0;
/*
 * Counted separately from `done`, because "every page already had it" is a SUCCESS —
 * a second run over the same `dist/` — while "no pages at all" is the build being
 * broken. Folding the two together made a harmless re-run exit 1.
 */
let already = 0;

for (const file of pages()) {
  let html;
  try {
    html = readFileSync(file, 'utf8');
  } catch {
    console.error(`beacon: ${file} is missing — did vite build and build:ssr run?`);
    process.exit(1);
  }

  if (html.includes(SENTINEL)) {
    already++;
    continue;
  }

  // Exactly one `</head>`, or this is not the file we think it is. A silent no-match
  // would ship an untracked page and read as success.
  if (!html.includes('</head>')) {
    console.error(`beacon: ${file} has no </head> to inject before`);
    process.exit(1);
  }

  writeFileSync(file, html.replace('</head>', `    ${snippet}\n  </head>`));
  done++;
}

if (done + already === 0) {
  console.error('beacon: found no pages to inject — dist/ is not what this expected');
  process.exit(1);
}

console.log(
  `beacon: Cloudflare Web Analytics injected into ${done} page(s) for "${env}"` +
    (already > 0 ? `, ${already} already had it.` : '.'),
);
